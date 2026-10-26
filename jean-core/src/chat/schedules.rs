//! Scheduled prompts: Claude's `ScheduleWakeup` and prompts the user
//! schedules for later. One list for both, persisted in `schedules.json`.
//!
//! Flow:
//! 1. A schedule comes from the Claude stream handler
//!    (`schedule_from_tool_input`, origin `agent`) or from the
//!    `create_schedule` command (origin `user`).
//! 2. It is saved to `schedules.json` and kept in an in-memory copy, which
//!    `to_session()` reads to fill `Session.scheduled_wakeup`.
//! 3. `BackgroundTaskManager` calls `fire_due()` every 10 s. A due schedule's
//!    prompt goes into the session's message queue; the Rust queue drain
//!    sends it. No window has to be open. `chat:wakeup_fired` only tells
//!    clients to update the UI. A one-off schedule is then removed; a
//!    repeating one moves to its next time after now.
//! 4. A schedule more than `MISSED_AFTER_SECS` late came due while the app
//!    or computer was off (or asleep). It runs once or is skipped, per the
//!    `schedule_missed_runs` preference — never once per missed time.
//!
//! Agent schedules keep the `ScheduleWakeup` contract: one per session, the
//! last one wins, delay clamped to 60–3600 s. User schedules have no limit.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::storage;
use super::types::{ScheduledWakeup, SessionMetadata};
use crate::http_server::EmitExt;

const MIN_DELAY_SECS: u64 = 60;
const MAX_DELAY_SECS: u64 = 3600;
/// A schedule this late was missed, not just caught by the 10 s poll.
const MISSED_AFTER_SECS: u64 = 600;

/// Repeat rule: a 5-field cron pattern read in an IANA time zone, so
/// "daily at 09:00" stays 09:00 across DST changes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Recurrence {
    pub cron: String,
    pub tz: String,
}

/// What happened the last time a repeating schedule came due.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    /// The prompt went into the session's queue
    Queued,
    /// Missed while the app was off, skipped per preference
    Skipped,
    /// Could not be queued (session or worktree gone)
    Failed,
}

/// The first time after `after_unix` that matches the rule.
pub fn next_occurrence(recurrence: &Recurrence, after_unix: u64) -> Result<u64, String> {
    use std::str::FromStr as _;
    let cron = croner::Cron::from_str(&recurrence.cron)
        .map_err(|e| format!("Invalid repeat pattern \"{}\": {e}", recurrence.cron))?;
    let tz: chrono_tz::Tz = recurrence
        .tz
        .parse()
        .map_err(|_| format!("Unknown time zone \"{}\"", recurrence.tz))?;
    let after = chrono::DateTime::from_timestamp(after_unix as i64, 0)
        .ok_or_else(|| format!("Invalid time {after_unix}"))?
        .with_timezone(&tz);
    let next = cron
        .find_next_occurrence(&after, false)
        .map_err(|e| format!("No next time for \"{}\": {e}", recurrence.cron))?;
    Ok(next.timestamp().max(0) as u64)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleOrigin {
    /// Claude's `ScheduleWakeup` tool
    Agent,
    /// Scheduled by the user
    User,
}

/// A prompt that fires into a session at `fire_at_unix`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Schedule {
    pub id: String,
    pub origin: ScheduleOrigin,
    pub session_id: String,
    pub worktree_id: String,
    pub prompt: String,
    #[serde(default)]
    pub reason: String,
    pub fire_at_unix: u64,
    pub created_at_unix: u64,
    /// The `ScheduleWakeup` tool call (agent schedules only)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Repeat rule; `None` = one-off, removed after it fires
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
    /// When a repeating schedule last came due
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_unix: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_outcome: Option<RunOutcome>,
}

impl Schedule {
    /// The shape the frontend already renders for a pending wakeup.
    pub fn to_wakeup(&self) -> ScheduledWakeup {
        ScheduledWakeup {
            fire_at_unix: self.fire_at_unix,
            scheduled_at_unix: self.created_at_unix,
            delay_seconds: self.fire_at_unix.saturating_sub(self.created_at_unix),
            prompt: self.prompt.clone(),
            reason: self.reason.clone(),
            tool_call_id: self.tool_call_id.clone().unwrap_or_else(|| self.id.clone()),
        }
    }
}

/// In-memory copy of `schedules.json`. The mutex also serializes writes to
/// the file.
static SCHEDULES: Lazy<Mutex<Vec<Schedule>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn schedules_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    Ok(dir.join("schedules.json"))
}

fn read_file(app: &AppHandle) -> Result<Vec<Schedule>, String> {
    let path = schedules_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read schedules file: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse schedules file: {e}"))
}

/// Atomic write: temp file + rename.
fn write_file(app: &AppHandle, schedules: &[Schedule]) -> Result<(), String> {
    let path = schedules_path(app)?;
    let json = serde_json::to_string_pretty(schedules)
        .map_err(|e| format!("Failed to serialize schedules: {e}"))?;
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, json).map_err(|e| format!("Failed to write schedules: {e}"))?;
    std::fs::rename(&temp_path, &path).map_err(|e| format!("Failed to finalize schedules: {e}"))
}

/// Change the list and save it, under one lock. The file is written only
/// when `f` reports a change.
fn update<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Vec<Schedule>) -> (bool, T),
) -> Result<T, String> {
    let mut schedules = SCHEDULES.lock().unwrap();
    let mut next = schedules.clone();
    let (changed, out) = f(&mut next);
    if changed {
        write_file(app, &next)?;
        *schedules = next;
    }
    Ok(out)
}

/// Payload broadcast to the frontend when a schedule fires.
#[derive(Debug, Clone, Serialize)]
pub struct WakeupFiredEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub worktree_path: String,
    pub prompt: String,
    pub tool_call_id: String,
    pub schedule_id: String,
}

/// Payload broadcast when a schedule is added (for UI countdown).
#[derive(Debug, Clone, Serialize)]
pub struct WakeupScheduledEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub wakeup: ScheduledWakeup,
    pub schedule_id: String,
}

/// Payload broadcast when a schedule is cancelled.
#[derive(Debug, Clone, Serialize)]
pub struct WakeupCancelledEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub tool_call_id: Option<String>,
    pub schedule_id: String,
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit_all(
        "cache:invalidate",
        &serde_json::json!({ "keys": ["sessions", "schedules"] }),
    );
}

fn emit_cancelled(app: &AppHandle, schedule: &Schedule) {
    let _ = app.emit_all(
        "chat:wakeup_cancelled",
        &WakeupCancelledEvent {
            session_id: schedule.session_id.clone(),
            worktree_id: schedule.worktree_id.clone(),
            tool_call_id: Some(schedule.to_wakeup().tool_call_id),
            schedule_id: schedule.id.clone(),
        },
    );
}

/// Extract scheduling parameters from a `ScheduleWakeup` tool_use input and
/// persist them as the session's agent schedule.
pub fn schedule_from_tool_input(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> Result<ScheduledWakeup, String> {
    let delay_raw = input
        .get("delaySeconds")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "ScheduleWakeup: missing delaySeconds".to_string())?;
    let delay_seconds = delay_raw.clamp(MIN_DELAY_SECS, MAX_DELAY_SECS);
    if delay_raw != delay_seconds {
        log::warn!(
            "ScheduleWakeup: delaySeconds {delay_raw} clamped to {delay_seconds} (session={session_id})"
        );
    }

    let prompt = input
        .get("prompt")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "ScheduleWakeup: missing prompt".to_string())?
        .to_string();
    if prompt.trim().is_empty() {
        return Err("ScheduleWakeup: prompt is empty".to_string());
    }

    let reason = input
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let now = now_unix();
    let schedule = Schedule {
        id: uuid::Uuid::new_v4().to_string(),
        origin: ScheduleOrigin::Agent,
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        prompt,
        reason,
        fire_at_unix: now.saturating_add(delay_seconds),
        created_at_unix: now,
        tool_call_id: Some(tool_call_id.to_string()),
        recurrence: None,
        last_run_unix: None,
        last_outcome: None,
    };
    let wakeup = schedule.to_wakeup();
    add(app, schedule)?;
    Ok(wakeup)
}

/// Schedule a user prompt into a session: once at `fire_at_unix`, or
/// repeating by `recurrence` (then the first time is the next match).
pub fn create(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    fire_at_unix: Option<u64>,
    recurrence: Option<Recurrence>,
) -> Result<Schedule, String> {
    if prompt.trim().is_empty() {
        return Err("Schedule: prompt is empty".to_string());
    }
    let now = now_unix();
    let fire_at_unix = match (&recurrence, fire_at_unix) {
        (Some(rule), _) => next_occurrence(rule, now)?,
        (None, Some(at)) => at,
        (None, None) => return Err("Schedule: give a time or a repeat rule".to_string()),
    };
    let metadata = storage::load_metadata(app, session_id)?
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    let schedule = Schedule {
        id: uuid::Uuid::new_v4().to_string(),
        origin: ScheduleOrigin::User,
        session_id: session_id.to_string(),
        worktree_id: metadata.worktree_id,
        prompt: prompt.to_string(),
        reason: String::new(),
        fire_at_unix,
        created_at_unix: now,
        tool_call_id: None,
        recurrence,
        last_run_unix: None,
        last_outcome: None,
    };
    add(app, schedule.clone())?;
    Ok(schedule)
}

/// Save a schedule. A new agent schedule replaces the session's previous
/// agent schedule (last wins, as `/loop` expects).
fn add(app: &AppHandle, schedule: Schedule) -> Result<(), String> {
    let replaced = update(app, |list| {
        let replaced = take_agent_schedule(list, &schedule);
        list.push(schedule.clone());
        (true, replaced)
    })?;

    if let Some(old) = &replaced {
        emit_cancelled(app, old);
    }
    let _ = app.emit_all(
        "chat:wakeup_scheduled",
        &WakeupScheduledEvent {
            session_id: schedule.session_id.clone(),
            worktree_id: schedule.worktree_id.clone(),
            wakeup: schedule.to_wakeup(),
            schedule_id: schedule.id.clone(),
        },
    );
    emit_changed(app);
    Ok(())
}

/// Remove the session's agent schedule when `new` is an agent schedule.
fn take_agent_schedule(list: &mut Vec<Schedule>, new: &Schedule) -> Option<Schedule> {
    if new.origin != ScheduleOrigin::Agent {
        return None;
    }
    let index = list
        .iter()
        .position(|s| s.origin == ScheduleOrigin::Agent && s.session_id == new.session_id)?;
    Some(list.remove(index))
}

/// Delete one schedule. Returns whether it existed.
pub fn delete(app: &AppHandle, schedule_id: &str) -> Result<bool, String> {
    let removed = update(app, |list| {
        let removed = list
            .iter()
            .position(|s| s.id == schedule_id)
            .map(|i| list.remove(i));
        (removed.is_some(), removed)
    })?;
    if let Some(schedule) = &removed {
        emit_cancelled(app, schedule);
        emit_changed(app);
    }
    Ok(removed.is_some())
}

/// Cancel every schedule of a session. Returns whether any existed.
pub fn cancel_session(app: &AppHandle, session_id: &str) -> Result<bool, String> {
    let removed = update(app, |list| {
        let (removed, kept): (Vec<_>, Vec<_>) =
            list.drain(..).partition(|s| s.session_id == session_id);
        *list = kept;
        (!removed.is_empty(), removed)
    })?;
    for schedule in &removed {
        emit_cancelled(app, schedule);
    }
    if !removed.is_empty() {
        emit_changed(app);
    }
    Ok(!removed.is_empty())
}

/// All schedules, soonest first.
pub fn list() -> Vec<Schedule> {
    let mut list = SCHEDULES.lock().unwrap().clone();
    list.sort_by_key(|s| s.fire_at_unix);
    list
}

/// The session's next schedule as a wakeup, for `Session.scheduled_wakeup`.
pub fn next_wakeup_for_session(session_id: &str) -> Option<ScheduledWakeup> {
    SCHEDULES
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s.session_id == session_id)
        .min_by_key(|s| s.fire_at_unix)
        .map(Schedule::to_wakeup)
}

/// Fire every schedule whose `fire_at_unix <= now`: put its prompt into the
/// session's queue, start the backend queue drain and emit
/// `chat:wakeup_fired` for the UI. One-off schedules are removed, repeating
/// ones move to their next time after now. A missed schedule is skipped when
/// the `schedule_missed_runs` preference says so.
///
/// Called by BackgroundTaskManager every ~10 s.
pub fn fire_due(app: &AppHandle) {
    let now = now_unix();
    // This runs every 10 s: read the preference only when a run was missed.
    let any_missed = SCHEDULES.lock().unwrap().iter().any(|s| is_missed(s, now));
    let skip_missed = any_missed && skip_missed_runs(app);

    let due = match update(app, |list| {
        let due = take_due(list, now, skip_missed);
        (!due.is_empty(), due)
    }) {
        Ok(due) => due,
        Err(e) => {
            log::warn!("schedules::fire_due: failed to update schedules: {e}");
            return;
        }
    };

    if due.is_empty() {
        return;
    }

    log::info!("schedules::fire_due: {} schedule(s) due", due.len());

    for (schedule, run) in due {
        if run && !fire(app, &schedule) {
            record_outcome(app, &schedule.id, RunOutcome::Failed);
        }
    }
    emit_changed(app);
}

fn is_missed(schedule: &Schedule, now: u64) -> bool {
    now.saturating_sub(schedule.fire_at_unix) > MISSED_AFTER_SECS
}

/// The `schedule_missed_runs` preference, read straight from the file.
/// Not `load_preferences_sync`: that also probes installed CLIs (spawns
/// processes), far too heavy for the scheduler tick.
fn skip_missed_runs(app: &AppHandle) -> bool {
    crate::get_preferences_path(app)
        .and_then(|path| std::fs::read_to_string(path).map_err(|e| e.to_string()))
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|prefs| {
            prefs
                .get("schedule_missed_runs")
                .and_then(Value::as_str)
                .map(|v| v == "skip")
        })
        .unwrap_or(false)
}

/// Take the due schedules out of `list`, with whether each should run.
/// Repeating schedules stay, moved to their next time after `now` and with
/// the outcome recorded; a rule that no longer parses is dropped.
fn take_due(list: &mut Vec<Schedule>, now: u64, skip_missed: bool) -> Vec<(Schedule, bool)> {
    let mut due = Vec::new();
    let mut kept = Vec::with_capacity(list.len());
    for mut schedule in list.drain(..) {
        if schedule.fire_at_unix > now {
            kept.push(schedule);
            continue;
        }
        let run = !(is_missed(&schedule, now) && skip_missed);
        if let Some(rule) = schedule.recurrence.clone() {
            match next_occurrence(&rule, now) {
                Ok(next) => {
                    let mut next_schedule = schedule.clone();
                    next_schedule.fire_at_unix = next;
                    next_schedule.last_run_unix = Some(now);
                    next_schedule.last_outcome = Some(if run {
                        RunOutcome::Queued
                    } else {
                        RunOutcome::Skipped
                    });
                    kept.push(next_schedule);
                }
                Err(e) => log::warn!("schedules: dropping schedule {}: {e}", schedule.id),
            }
        }
        schedule.last_run_unix = Some(now);
        due.push((schedule, run));
    }
    *list = kept;
    due
}

/// Queue one schedule's prompt and start the drain. Returns false when the
/// session or worktree is gone.
fn fire(app: &AppHandle, schedule: &Schedule) -> bool {
    let worktree_path = resolve_worktree_path(app, &schedule.worktree_id).unwrap_or_default();
    if worktree_path.is_empty() {
        log::warn!(
            "schedules::fire: cannot resolve worktree_path for worktree_id={}, skipping",
            schedule.worktree_id
        );
        return false;
    }

    let queue = match enqueue(app, schedule) {
        Ok(queue) => queue,
        Err(e) => {
            log::warn!(
                "schedules::fire: failed to enqueue schedule for session={}: {e}",
                schedule.session_id
            );
            return false;
        }
    };

    let _ = app.emit_all(
        "queue:updated",
        &serde_json::json!({ "sessionId": schedule.session_id, "queue": queue }),
    );
    super::commands::trigger_backend_queue_drain(
        app.clone(),
        schedule.worktree_id.clone(),
        worktree_path.clone(),
        schedule.session_id.clone(),
    );

    let _ = app.emit_all(
        "chat:wakeup_fired",
        &WakeupFiredEvent {
            session_id: schedule.session_id.clone(),
            worktree_id: schedule.worktree_id.clone(),
            worktree_path,
            prompt: schedule.prompt.clone(),
            tool_call_id: schedule.to_wakeup().tool_call_id,
            schedule_id: schedule.id.clone(),
        },
    );
    true
}

/// Mark a repeating schedule's last run (still in the list) as failed.
fn record_outcome(app: &AppHandle, schedule_id: &str, outcome: RunOutcome) {
    let _ = update(app, |list| {
        let found = list.iter_mut().find(|s| s.id == schedule_id);
        let changed = found.is_some();
        if let Some(schedule) = found {
            schedule.last_outcome = Some(outcome);
        }
        (changed, ())
    });
}

/// Append the schedule's prompt to the session's message queue.
fn enqueue(app: &AppHandle, schedule: &Schedule) -> Result<Vec<Value>, String> {
    storage::with_existing_metadata_mut(app, &schedule.session_id, |m| {
        let message = queued_message(m, &schedule.prompt, now_unix());
        m.queued_messages.push(message);
        m.queued_messages.clone()
    })
}

/// Build a queued message (frontend `QueuedMessage` shape) for a fired
/// schedule. Settings come only from the session's saved selections; a
/// setting the session never saved stays out, so `send_chat_message`
/// resolves it from the session and preferences instead of a hard-coded
/// default.
fn queued_message(metadata: &SessionMetadata, prompt: &str, now: u64) -> Value {
    let mut message = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "message": prompt,
        "pendingImages": [],
        "pendingFiles": [],
        "pendingSkills": [],
        "pendingTextFiles": [],
        "provider": metadata.selected_provider,
        "backend": metadata.backend,
        "queuedAt": now.saturating_mul(1000),
    });
    let fields = message.as_object_mut().expect("json object");
    if let Some(model) = &metadata.selected_model {
        fields.insert("model".into(), Value::from(model.clone()));
    }
    if let Some(mode) = &metadata.selected_execution_mode {
        fields.insert("executionMode".into(), Value::from(mode.clone()));
    }
    if let Some(level) = &metadata.selected_thinking_level {
        fields.insert(
            "thinkingLevel".into(),
            serde_json::to_value(level).unwrap_or_default(),
        );
    }
    if let Some(level) = &metadata.selected_effort_level {
        fields.insert(
            "effortLevel".into(),
            serde_json::to_value(level).unwrap_or_default(),
        );
    }
    message
}

/// Resolve a worktree's filesystem path from its ID via the projects registry.
fn resolve_worktree_path(app: &AppHandle, worktree_id: &str) -> Option<String> {
    let data = crate::projects::storage::load_projects_data(app).ok()?;
    data.find_worktree(worktree_id).map(|w| w.path.clone())
}

/// Load `schedules.json` into memory and move wakeups still stored on
/// session metadata (before `schedules.json` existed) into it. Called once
/// at app startup. Due schedules fire on the next `fire_due()` tick.
pub fn load_all_from_disk(app: &AppHandle) -> Result<usize, String> {
    let from_file = read_file(app)?;
    *SCHEDULES.lock().unwrap() = from_file;

    let migrated = migrate_session_wakeups(app)?;
    let loaded = SCHEDULES.lock().unwrap().len();
    log::info!("schedules::load_all_from_disk: loaded {loaded} schedule(s), migrated {migrated}");
    Ok(loaded)
}

/// Move each `SessionMetadata.scheduled_wakeup` into the schedule list as an
/// agent schedule, then clear the field. Safe to run again: a wakeup whose
/// tool call is already in the list is only cleared.
fn migrate_session_wakeups(app: &AppHandle) -> Result<usize, String> {
    let data_dir = storage::get_data_dir(app)?;
    let Ok(read_dir) = std::fs::read_dir(&data_dir) else {
        return Ok(0);
    };

    let mut migrated = 0usize;
    for entry in read_dir.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Some(session_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Ok(Some(metadata)) = storage::load_metadata(app, &session_id) else {
            continue;
        };
        let Some(wakeup) = metadata.scheduled_wakeup.clone() else {
            continue;
        };

        update(app, |list| {
            let known = list
                .iter()
                .any(|s| s.tool_call_id.as_deref() == Some(wakeup.tool_call_id.as_str()));
            if !known {
                list.push(Schedule {
                    id: uuid::Uuid::new_v4().to_string(),
                    origin: ScheduleOrigin::Agent,
                    session_id: metadata.id.clone(),
                    worktree_id: metadata.worktree_id.clone(),
                    prompt: wakeup.prompt.clone(),
                    reason: wakeup.reason.clone(),
                    fire_at_unix: wakeup.fire_at_unix,
                    created_at_unix: wakeup.scheduled_at_unix,
                    tool_call_id: Some(wakeup.tool_call_id.clone()),
                    recurrence: None,
                    last_run_unix: None,
                    last_outcome: None,
                });
            }
            (!known, ())
        })?;
        storage::with_existing_metadata_mut(app, &session_id, |m| m.scheduled_wakeup = None)?;
        migrated += 1;
    }
    Ok(migrated)
}

/// Entry returned by `list_pending`: session context + wakeup payload.
#[derive(Debug, Clone, Serialize)]
pub struct PendingWakeupEntry {
    pub session_id: String,
    pub worktree_id: String,
    pub wakeup: ScheduledWakeup,
}

/// All pending schedules as wakeups. Used by the frontend on mount to hydrate
/// the store, so reloads do not leave historical ScheduleWakeup tool_use
/// blocks stuck in the "pending" state.
pub fn list_pending() -> Vec<PendingWakeupEntry> {
    list()
        .iter()
        .map(|s| PendingWakeupEntry {
            session_id: s.session_id.clone(),
            worktree_id: s.worktree_id.clone(),
            wakeup: s.to_wakeup(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeContext;

    // The in-memory list is process-wide and tests run in parallel, so each
    // test uses its own session ids and only looks at those.

    fn app() -> (tempfile::TempDir, RuntimeContext) {
        let temp = tempfile::tempdir().unwrap();
        let app = RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        (temp, app)
    }

    fn session(app: &RuntimeContext, session_id: &str) {
        storage::with_metadata_mut(app, session_id, "w1", "Session", 0, |_| Ok(())).unwrap();
    }

    fn of_session(session_id: &str) -> Vec<Schedule> {
        list()
            .into_iter()
            .filter(|s| s.session_id == session_id)
            .collect()
    }

    fn on_disk(app: &RuntimeContext, session_id: &str) -> Vec<Schedule> {
        read_file(app)
            .unwrap()
            .into_iter()
            .filter(|s| s.session_id == session_id)
            .collect()
    }

    fn tool_input(delay: u64) -> Value {
        serde_json::json!({ "delaySeconds": delay, "prompt": "check the build" })
    }

    #[test]
    fn the_delay_is_clamped() {
        let (_temp, app) = app();
        let short = schedule_from_tool_input(&app, "clamp-1", "w1", "t1", &tool_input(10));
        assert_eq!(short.unwrap().delay_seconds, MIN_DELAY_SECS);
        let long = schedule_from_tool_input(&app, "clamp-2", "w1", "t2", &tool_input(100_000));
        assert_eq!(long.unwrap().delay_seconds, MAX_DELAY_SECS);
    }

    #[test]
    fn schedules_are_saved_to_disk() {
        let (_temp, app) = app();
        session(&app, "disk-1");
        let schedule = create(&app, "disk-1", "later", Some(4_000_000_000), None).unwrap();

        assert_eq!(on_disk(&app, "disk-1"), vec![schedule.clone()]);
        assert_eq!(of_session("disk-1"), vec![schedule]);
    }

    #[test]
    fn a_new_agent_wakeup_replaces_only_the_old_agent_wakeup() {
        let (_temp, app) = app();
        session(&app, "agent-1");
        let user = create(&app, "agent-1", "user prompt", Some(4_000_000_000), None).unwrap();
        schedule_from_tool_input(&app, "agent-1", "w1", "t1", &tool_input(60)).unwrap();
        schedule_from_tool_input(&app, "agent-1", "w1", "t2", &tool_input(60)).unwrap();

        let schedules = of_session("agent-1");
        assert_eq!(schedules.len(), 2);
        assert!(schedules.contains(&user));
        let agent: Vec<_> = schedules
            .iter()
            .filter(|s| s.origin == ScheduleOrigin::Agent)
            .collect();
        assert_eq!(agent.len(), 1);
        assert_eq!(agent[0].tool_call_id.as_deref(), Some("t2"));
    }

    #[test]
    fn a_session_holds_many_user_schedules() {
        let (_temp, app) = app();
        session(&app, "many-1");
        let later = create(&app, "many-1", "second", Some(4_000_000_200), None).unwrap();
        let sooner = create(&app, "many-1", "first", Some(4_000_000_100), None).unwrap();

        assert_eq!(of_session("many-1"), vec![sooner.clone(), later]);
        assert_eq!(
            next_wakeup_for_session("many-1").unwrap().prompt,
            sooner.prompt
        );
    }

    #[test]
    fn delete_removes_one_schedule() {
        let (_temp, app) = app();
        session(&app, "delete-1");
        let keep = create(&app, "delete-1", "keep", Some(4_000_000_000), None).unwrap();
        let drop = create(&app, "delete-1", "drop", Some(4_000_000_000), None).unwrap();

        assert!(delete(&app, &drop.id).unwrap());
        assert!(!delete(&app, &drop.id).unwrap());
        assert_eq!(of_session("delete-1"), vec![keep.clone()]);
        assert_eq!(on_disk(&app, "delete-1"), vec![keep]);
    }

    #[test]
    fn cancel_session_removes_all_its_schedules() {
        let (_temp, app) = app();
        session(&app, "cancel-1");
        create(&app, "cancel-1", "a", Some(4_000_000_000), None).unwrap();
        create(&app, "cancel-1", "b", Some(4_000_000_000), None).unwrap();

        assert!(cancel_session(&app, "cancel-1").unwrap());
        assert!(of_session("cancel-1").is_empty());
    }

    // A fired schedule must land in the backend queue, so it runs with no
    // window open.
    #[test]
    fn a_fired_schedule_moves_into_the_message_queue() {
        let (_temp, app) = app();
        session(&app, "fire-1");
        let schedule = create(&app, "fire-1", "check the build", Some(0), None).unwrap();

        let queue = enqueue(&app, &schedule).unwrap();

        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0]["message"], "check the build");
        let metadata = storage::load_metadata(&app, "fire-1").unwrap().unwrap();
        assert_eq!(metadata.queued_messages, queue);
    }

    #[test]
    fn a_session_wakeup_moves_into_the_list_once() {
        let (_temp, app) = app();
        let wakeup = ScheduledWakeup {
            fire_at_unix: 4_000_000_000,
            scheduled_at_unix: 3_999_999_000,
            delay_seconds: 1000,
            prompt: "old wakeup".into(),
            reason: String::new(),
            tool_call_id: "migrate-tool-1".into(),
        };
        storage::with_metadata_mut(&app, "migrate-1", "w1", "Session", 0, |m| {
            m.scheduled_wakeup = Some(wakeup.clone());
            Ok(())
        })
        .unwrap();

        migrate_session_wakeups(&app).unwrap();
        // A second start must not add it twice.
        storage::with_existing_metadata_mut(&app, "migrate-1", |m| {
            m.scheduled_wakeup = Some(wakeup.clone())
        })
        .unwrap();
        migrate_session_wakeups(&app).unwrap();

        let schedules = of_session("migrate-1");
        assert_eq!(schedules.len(), 1);
        assert_eq!(schedules[0].to_wakeup(), wakeup);
        assert_eq!(on_disk(&app, "migrate-1"), schedules);
        let metadata = storage::load_metadata(&app, "migrate-1").unwrap().unwrap();
        assert!(metadata.scheduled_wakeup.is_none());
    }

    // No hard-coded model or mode: an unset setting stays out so the send
    // resolves it from the session, never as 'sonnet' / 'yolo'.
    #[test]
    fn the_queued_message_only_carries_saved_session_settings() {
        let mut metadata = SessionMetadata::new("s1".into(), "w1".into(), "Session".into(), 0);
        let bare = queued_message(&metadata, "p", 7);
        assert!(bare.get("model").is_none());
        assert!(bare.get("executionMode").is_none());
        assert!(bare.get("thinkingLevel").is_none());
        assert_eq!(bare["queuedAt"], 7000);

        metadata.selected_model = Some("claude-opus-4-8".into());
        metadata.selected_execution_mode = Some("plan".into());
        let saved = queued_message(&metadata, "p", 7);
        assert_eq!(saved["model"], "claude-opus-4-8");
        assert_eq!(saved["executionMode"], "plan");
    }

    fn daily_9_berlin() -> Recurrence {
        Recurrence {
            cron: "0 9 * * *".into(),
            tz: "Europe/Berlin".into(),
        }
    }

    fn unix(rfc3339: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .timestamp() as u64
    }

    fn repeating(id: &str, fire_at_unix: u64) -> Schedule {
        Schedule {
            id: id.into(),
            origin: ScheduleOrigin::User,
            session_id: "s".into(),
            worktree_id: "w".into(),
            prompt: "p".into(),
            reason: String::new(),
            fire_at_unix,
            created_at_unix: 0,
            tool_call_id: None,
            recurrence: Some(daily_9_berlin()),
            last_run_unix: None,
            last_outcome: None,
        }
    }

    #[test]
    fn daily_at_nine_stays_at_nine_across_dst() {
        // Berlin leaves summer time on 2026-10-25: 09:00 is 07:00 UTC
        // before, 08:00 UTC after.
        let before = next_occurrence(&daily_9_berlin(), unix("2026-10-24T10:00:00Z")).unwrap();
        assert_eq!(before, unix("2026-10-25T08:00:00Z"));
        let summer = next_occurrence(&daily_9_berlin(), unix("2026-10-23T10:00:00Z")).unwrap();
        assert_eq!(summer, unix("2026-10-24T07:00:00Z"));
        // Spring forward, 2026-03-29.
        let spring = next_occurrence(&daily_9_berlin(), unix("2026-03-28T10:00:00Z")).unwrap();
        assert_eq!(spring, unix("2026-03-29T07:00:00Z"));
    }

    #[test]
    fn weekdays_skip_the_weekend() {
        let rule = Recurrence {
            cron: "30 8 * * 1-5".into(),
            tz: "UTC".into(),
        };
        // Friday 2026-10-23 after 08:30 -> Monday 2026-10-26.
        let next = next_occurrence(&rule, unix("2026-10-23T09:00:00Z")).unwrap();
        assert_eq!(next, unix("2026-10-26T08:30:00Z"));
    }

    #[test]
    fn a_bad_pattern_or_zone_is_an_error() {
        let bad_cron = Recurrence {
            cron: "not cron".into(),
            tz: "UTC".into(),
        };
        assert!(next_occurrence(&bad_cron, 0).is_err());
        let bad_tz = Recurrence {
            cron: "0 9 * * *".into(),
            tz: "Mars/Olympus".into(),
        };
        assert!(next_occurrence(&bad_tz, 0).is_err());
    }

    #[test]
    fn a_due_one_off_leaves_the_list() {
        let mut one_off = repeating("one", 100);
        one_off.recurrence = None;
        let mut list = vec![one_off, repeating("later", 10_000)];

        let due = take_due(&mut list, 150, false);

        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0.id, "one");
        assert!(due[0].1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "later");
    }

    #[test]
    fn a_due_repeating_schedule_moves_to_its_next_time() {
        let now = unix("2026-10-26T07:00:30Z"); // 08:00:30 Berlin
        let mut list = vec![repeating("daily", unix("2026-10-26T08:00:00Z") - 3600)];

        let due = take_due(&mut list, now, false);

        assert_eq!(due.len(), 1);
        assert!(due[0].1);
        assert_eq!(list[0].fire_at_unix, unix("2026-10-26T08:00:00Z"));
        assert_eq!(list[0].last_run_unix, Some(now));
        assert_eq!(list[0].last_outcome, Some(RunOutcome::Queued));
    }

    // Off for three days: the daily schedule runs once (or not), never three
    // times, and its next time is after now.
    #[test]
    fn a_missed_schedule_runs_once_or_is_skipped() {
        let now = unix("2026-10-26T12:00:00Z");
        let three_days_ago = unix("2026-10-23T07:00:00Z");

        let mut list = vec![repeating("daily", three_days_ago)];
        let due = take_due(&mut list, now, false);
        assert_eq!(due.len(), 1);
        assert!(due[0].1);
        assert!(list[0].fire_at_unix > now);

        let mut list = vec![repeating("daily", three_days_ago)];
        let due = take_due(&mut list, now, true);
        assert_eq!(due.len(), 1);
        assert!(!due[0].1);
        assert_eq!(list[0].last_outcome, Some(RunOutcome::Skipped));
        assert!(list[0].fire_at_unix > now);
    }

    #[test]
    fn a_schedule_caught_by_the_poll_is_not_missed() {
        let mut list = vec![repeating("daily", 1_000)];
        let due = take_due(&mut list, 1_000 + 30, true);
        assert!(due[0].1);
    }

    #[test]
    fn create_with_a_repeat_rule_starts_at_the_next_match() {
        let (_temp, app) = app();
        session(&app, "repeat-1");
        let schedule = create(&app, "repeat-1", "daily", None, Some(daily_9_berlin())).unwrap();
        assert!(schedule.fire_at_unix > now_unix());
        assert_eq!(
            schedule.fire_at_unix,
            next_occurrence(&daily_9_berlin(), schedule.created_at_unix).unwrap()
        );
    }
}
