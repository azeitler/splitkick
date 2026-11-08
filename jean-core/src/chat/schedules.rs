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

/// Where a schedule's prompt goes when it fires.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleTarget {
    /// Into `session_id`, the session the schedule was made in
    #[default]
    Session,
    /// Into a new session in `worktree_id`, one per run (clean context)
    NewSession,
}

fn default_true() -> bool {
    true
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
    /// Shown in the Scheduled view; empty = the prompt is the name
    #[serde(default)]
    pub name: String,
    /// `false` = paused: it stays in the list but does not fire
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub target: ScheduleTarget,
    /// The session the schedule was made in (for `NewSession`: where it
    /// shows in the chat, not where it runs)
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
    /// Why the last run failed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// The session the last run went into
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_session_id: Option<String>,
    /// Settings captured from the composer toolbar when the user made the
    /// schedule: the frontend `QueuedMessage` shape (backend, model,
    /// provider, effort, mode, MCP config, attachments). `None` = use the
    /// session's saved settings at fire time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<Value>,
}

/// Optional parts of a new user schedule.
#[derive(Debug, Clone, Default)]
pub struct ScheduleOptions {
    pub name: Option<String>,
    pub target: ScheduleTarget,
    pub template: Option<Value>,
}

impl Schedule {
    fn new(
        origin: ScheduleOrigin,
        session_id: &str,
        worktree_id: &str,
        prompt: String,
        fire_at_unix: u64,
        created_at_unix: u64,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            origin,
            name: String::new(),
            enabled: true,
            target: ScheduleTarget::Session,
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            prompt,
            reason: String::new(),
            fire_at_unix,
            created_at_unix,
            tool_call_id: None,
            recurrence: None,
            last_run_unix: None,
            last_outcome: None,
            last_error: None,
            last_session_id: None,
            template: None,
        }
    }

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
    let mut schedule = Schedule::new(
        ScheduleOrigin::Agent,
        session_id,
        worktree_id,
        prompt,
        now.saturating_add(delay_seconds),
        now,
    );
    schedule.reason = reason;
    schedule.tool_call_id = Some(tool_call_id.to_string());
    let wakeup = schedule.to_wakeup();
    add(app, schedule)?;
    Ok(wakeup)
}

/// The first fire time: the next match of a repeat rule, else `fire_at_unix`.
fn first_fire_time(
    fire_at_unix: Option<u64>,
    recurrence: Option<&Recurrence>,
    now: u64,
) -> Result<u64, String> {
    match (recurrence, fire_at_unix) {
        (Some(rule), _) => next_occurrence(rule, now),
        (None, Some(at)) => Ok(at),
        (None, None) => Err("Schedule: give a time or a repeat rule".to_string()),
    }
}

/// Where a session lives, for scheduling into it.
struct SessionRef {
    worktree_id: String,
    name: String,
    order: u32,
    archived_at: Option<u64>,
}

/// Look up a session: from its metadata, or, for a session that never sent a
/// message (its metadata file does not exist yet), from the worktree indexes.
fn find_session(app: &AppHandle, session_id: &str) -> Result<SessionRef, String> {
    if let Some(m) = storage::load_metadata(app, session_id)? {
        return Ok(SessionRef {
            worktree_id: m.worktree_id,
            name: m.name,
            order: m.order,
            archived_at: m.archived_at,
        });
    }
    let dir = storage::get_index_dir(app)?;
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(worktree_id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(index) = storage::load_index(app, worktree_id) else {
            continue;
        };
        if let Some(found) = index.sessions.iter().find(|s| s.id == session_id) {
            return Ok(SessionRef {
                worktree_id: worktree_id.to_string(),
                name: found.name.clone(),
                order: found.order,
                archived_at: found.archived_at,
            });
        }
    }
    Err(format!("Session not found: {session_id}"))
}

/// Schedule a user prompt into a session: once at `fire_at_unix`, or
/// repeating by `recurrence` (then the first time is the next match).
pub fn create(
    app: &AppHandle,
    session_id: &str,
    prompt: &str,
    fire_at_unix: Option<u64>,
    recurrence: Option<Recurrence>,
    options: ScheduleOptions,
) -> Result<Schedule, String> {
    if prompt.trim().is_empty() {
        return Err("Schedule: prompt is empty".to_string());
    }
    let now = now_unix();
    let fire_at_unix = first_fire_time(fire_at_unix, recurrence.as_ref(), now)?;
    let session = find_session(app, session_id)?;
    let mut schedule = Schedule::new(
        ScheduleOrigin::User,
        session_id,
        &session.worktree_id,
        prompt.to_string(),
        fire_at_unix,
        now,
    );
    schedule.recurrence = recurrence;
    schedule.name = options.name.unwrap_or_default().trim().to_string();
    schedule.target = options.target;
    schedule.template = options.template.filter(Value::is_object);
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

/// New values for an existing schedule (Edit in the Scheduled view). A
/// one-off stays a one-off: `recurrence` is used only when the schedule
/// already repeats, `fire_at_unix` only when it does not.
#[derive(Debug, Clone, Default)]
pub struct ScheduleEdit {
    pub prompt: String,
    pub name: String,
    pub target: ScheduleTarget,
    pub fire_at_unix: Option<u64>,
    pub recurrence: Option<Recurrence>,
}

/// Change a schedule's prompt, name, target and time. Returns the new
/// schedule.
pub fn edit(app: &AppHandle, schedule_id: &str, changes: ScheduleEdit) -> Result<Schedule, String> {
    if changes.prompt.trim().is_empty() {
        return Err("Schedule: prompt is empty".to_string());
    }
    let now = now_unix();
    let edited = update(app, |list| {
        let Some(schedule) = list.iter_mut().find(|s| s.id == schedule_id) else {
            return (false, Err(format!("Schedule not found: {schedule_id}")));
        };
        let recurrence = schedule.recurrence.as_ref().and(changes.recurrence.clone());
        let fire_at = match first_fire_time(changes.fire_at_unix, recurrence.as_ref(), now) {
            Ok(at) => at,
            Err(e) => return (false, Err(e)),
        };
        schedule.prompt = changes.prompt.trim().to_string();
        schedule.name = changes.name.trim().to_string();
        schedule.target = changes.target;
        if recurrence.is_some() {
            schedule.recurrence = recurrence;
        }
        schedule.fire_at_unix = fire_at;
        (true, Ok(schedule.clone()))
    })??;
    emit_changed(app);
    Ok(edited)
}

/// Pause (`false`) or resume (`true`) a schedule. On resume a repeating
/// schedule moves to its next time after now, and a one-off whose time
/// passed while paused runs at the next tick.
pub fn set_enabled(app: &AppHandle, schedule_id: &str, enabled: bool) -> Result<Schedule, String> {
    let now = now_unix();
    let schedule = update(app, |list| {
        let Some(schedule) = list.iter_mut().find(|s| s.id == schedule_id) else {
            return (false, Err(format!("Schedule not found: {schedule_id}")));
        };
        apply_enabled(schedule, enabled, now);
        (true, Ok(schedule.clone()))
    })??;
    emit_changed(app);
    Ok(schedule)
}

fn apply_enabled(schedule: &mut Schedule, enabled: bool, now: u64) {
    schedule.enabled = enabled;
    if !enabled {
        return;
    }
    schedule.last_error = None;
    match &schedule.recurrence {
        Some(rule) => {
            if let Ok(next) = next_occurrence(rule, now) {
                schedule.fire_at_unix = next;
            }
        }
        None => schedule.fire_at_unix = schedule.fire_at_unix.max(now),
    }
}

/// Run a schedule now, also a paused one. A repeating schedule keeps its
/// next time; a one-off that ran is done and leaves the list. Returns the
/// session the prompt went into.
pub async fn run_now(app: &AppHandle, schedule_id: &str) -> Result<String, String> {
    let schedule = SCHEDULES
        .lock()
        .unwrap()
        .iter()
        .find(|s| s.id == schedule_id)
        .cloned()
        .ok_or_else(|| format!("Schedule not found: {schedule_id}"))?;
    let result = fire(app, &schedule).await;
    let now = now_unix();
    update(app, |list| {
        if result.is_ok() && schedule.recurrence.is_none() {
            list.retain(|s| s.id != schedule.id);
            return (true, ());
        }
        if let Some(stored) = list.iter_mut().find(|s| s.id == schedule.id) {
            stored.last_run_unix = Some(now);
            if result.is_ok() {
                stored.last_outcome = Some(RunOutcome::Queued);
                stored.last_error = None;
            }
        }
        apply_fire_result(list, &schedule, &result);
        (true, ())
    })?;
    emit_changed(app);
    result
}

/// A schedule an agent makes through the Splitkick MCP `create_schedule`.
#[derive(Debug, Clone, Default)]
pub struct AgentScheduleRequest {
    /// The session whose agent asks; `None` for a client outside a session
    pub caller_session_id: Option<String>,
    /// Run into this session (default: the caller)
    pub session_id: Option<String>,
    /// Run into a new session in this worktree each time instead
    pub worktree_id: Option<String>,
    pub prompt: String,
    pub name: Option<String>,
    pub fire_at_unix: Option<u64>,
    pub recurrence: Option<Recurrence>,
}

fn mode_rank(mode: &str) -> u8 {
    match mode {
        "yolo" => 2,
        "build" => 1,
        _ => 0,
    }
}

/// The mode an agent schedule runs in: the lower of the caller's and the
/// target session's mode, so an agent never schedules a run with more
/// rights than it has (plan Q3). A session that never saved a mode counts as
/// plan for the caller; an unknown target takes the caller's mode.
fn capped_mode(caller: Option<&str>, target: Option<&str>) -> String {
    let caller = caller.or(target).unwrap_or("plan");
    let target = target.unwrap_or(caller);
    if mode_rank(target) < mode_rank(caller) {
        target.to_string()
    } else {
        caller.to_string()
    }
}

/// Save an agent schedule (origin `agent`). Like `ScheduleWakeup`, the new
/// one replaces the session's previous agent schedule.
pub fn create_for_agent(
    app: &AppHandle,
    request: AgentScheduleRequest,
) -> Result<Schedule, String> {
    if request.prompt.trim().is_empty() {
        return Err("Schedule: prompt is empty".to_string());
    }
    let now = now_unix();
    let fire_at_unix = first_fire_time(request.fire_at_unix, request.recurrence.as_ref(), now)?;
    if request.recurrence.is_none() && fire_at_unix <= now {
        return Err("Schedule: the time is in the past".to_string());
    }
    let load = |session_id: &str| {
        storage::load_metadata(app, session_id)?
            .ok_or_else(|| format!("Unknown sessionId: {session_id}"))
    };
    let caller = match &request.caller_session_id {
        Some(id) => load(id).ok(),
        None => None,
    };
    let caller_mode = caller.as_ref().map(|m| {
        m.selected_execution_mode
            .clone()
            .unwrap_or_else(|| "plan".into())
    });

    let (target, session_id, worktree_id, target_mode) = match &request.worktree_id {
        Some(worktree_id) => {
            resolve_worktree_path(app, worktree_id)
                .ok_or_else(|| format!("Unknown worktreeId: {worktree_id}"))?;
            super::ensure_worktree_not_archived(
                worktree_id,
                super::worktree_archived_at(app, worktree_id),
            )?;
            let session_id = request.caller_session_id.clone().unwrap_or_default();
            (
                ScheduleTarget::NewSession,
                session_id,
                worktree_id.clone(),
                None,
            )
        }
        None => {
            let session_id = request
                .session_id
                .clone()
                .or_else(|| request.caller_session_id.clone())
                .ok_or_else(|| "Give sessionId or worktreeId".to_string())?;
            let target = find_session(app, &session_id)?;
            super::ensure_session_can_run(
                &session_id,
                target.archived_at,
                &target.worktree_id,
                super::worktree_archived_at(app, &target.worktree_id),
            )?;
            let mode = load(&session_id)
                .ok()
                .and_then(|m| m.selected_execution_mode);
            (
                ScheduleTarget::Session,
                session_id,
                target.worktree_id,
                mode,
            )
        }
    };

    let mut schedule = Schedule::new(
        ScheduleOrigin::Agent,
        &session_id,
        &worktree_id,
        request.prompt.trim().to_string(),
        fire_at_unix,
        now,
    );
    schedule.name = request.name.unwrap_or_default().trim().to_string();
    schedule.target = target;
    schedule.recurrence = request.recurrence;
    schedule.template = Some(serde_json::json!({
        "executionMode": capped_mode(caller_mode.as_deref(), target_mode.as_deref()),
    }));
    add(app, schedule.clone())?;
    Ok(schedule)
}

/// What the desktop shows when a scheduled run ends with no window open.
#[derive(Debug, Clone)]
pub struct ScheduledRunNotice {
    pub title: String,
    pub body: String,
    pub project_id: String,
    pub worktree_id: String,
    pub session_id: String,
}

type RunNotifier = Box<dyn Fn(ScheduledRunNotice) + Send + Sync>;

/// Set by the desktop shell; it decides whether a window is open. The
/// headless server sets none: there a connected client notifies.
static RUN_NOTIFIER: std::sync::OnceLock<RunNotifier> = std::sync::OnceLock::new();

/// Install the native notification for scheduled runs. First call wins.
pub fn set_run_notifier(notifier: impl Fn(ScheduledRunNotice) + Send + Sync + 'static) {
    let _ = RUN_NOTIFIER.set(Box::new(notifier));
}

/// A queued message from a schedule finished its run (called by the queue
/// drain). A failed send is recorded on the schedule, which stays enabled
/// (the user may fix the model or MCP server with Edit). Then the native
/// notification, if the preference allows it.
pub fn scheduled_run_finished(
    app: &AppHandle,
    schedule_id: &str,
    session_id: &str,
    worktree_id: &str,
    error: Option<&str>,
) {
    let schedule = SCHEDULES
        .lock()
        .unwrap()
        .iter()
        .find(|s| s.id == schedule_id)
        .cloned();
    if let Some(error) = error {
        let _ = update(app, |list| {
            let found = list.iter_mut().find(|s| s.id == schedule_id);
            let changed = found.is_some();
            if let Some(s) = found {
                s.last_outcome = Some(RunOutcome::Failed);
                s.last_error = Some(error.to_string());
            }
            (changed, ())
        });
        emit_changed(app);
    }

    let Some(notifier) = RUN_NOTIFIER.get() else {
        return;
    };
    if !desktop_notifications_enabled(app) {
        return;
    }
    let Some(project_id) = crate::projects::storage::load_projects_data(app)
        .ok()
        .and_then(|data| {
            data.find_worktree(worktree_id)
                .map(|w| w.project_id.clone())
        })
    else {
        return;
    };
    let waiting = storage::load_metadata(app, session_id)
        .ok()
        .flatten()
        .is_some_and(|m| m.waiting_for_input);
    let title = if error.is_some() {
        "Scheduled run failed"
    } else if waiting {
        "Scheduled run needs your input"
    } else {
        "Scheduled run finished"
    };
    let body = schedule
        .map(|s| if s.name.is_empty() { s.prompt } else { s.name })
        .unwrap_or_default();
    notifier(ScheduledRunNotice {
        title: title.to_string(),
        body: body.chars().take(160).collect(),
        project_id,
        worktree_id: worktree_id.to_string(),
        session_id: session_id.to_string(),
    });
}

/// The `desktop_notifications_enabled` preference (default on), read from
/// the file like `skip_missed_runs`.
fn desktop_notifications_enabled(app: &AppHandle) -> bool {
    crate::get_preferences_path(app)
        .and_then(|path| std::fs::read_to_string(path).map_err(|e| e.to_string()))
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|prefs| {
            prefs
                .get("desktop_notifications_enabled")
                .and_then(Value::as_bool)
        })
        .unwrap_or(true)
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
        .filter(|s| s.enabled && s.session_id == session_id)
        .min_by_key(|s| s.fire_at_unix)
        .map(Schedule::to_wakeup)
}

/// Fire every enabled schedule whose `fire_at_unix <= now`: put its prompt
/// into the target session's queue, start the backend queue drain and emit
/// `chat:wakeup_fired` for the UI. One-off schedules are removed, repeating
/// ones move to their next time after now. A missed schedule is skipped when
/// the `schedule_missed_runs` preference says so.
///
/// Called by BackgroundTaskManager every ~10 s.
pub async fn fire_due(app: &AppHandle) {
    let now = now_unix();
    // This runs every 10 s: read the preference only when a run was missed.
    let any_missed = SCHEDULES
        .lock()
        .unwrap()
        .iter()
        .any(|s| s.enabled && is_missed(s, now));
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
        if run {
            let result = fire(app, &schedule).await;
            record_fire(app, &schedule, result);
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
/// Paused schedules are left alone. Repeating schedules stay, moved to their
/// next time after `now` and with the outcome recorded; a rule that no
/// longer parses is dropped.
fn take_due(list: &mut Vec<Schedule>, now: u64, skip_missed: bool) -> Vec<(Schedule, bool)> {
    let mut due = Vec::new();
    let mut kept = Vec::with_capacity(list.len());
    for mut schedule in list.drain(..) {
        if !schedule.enabled || schedule.fire_at_unix > now {
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
                    next_schedule.last_error = None;
                    kept.push(next_schedule);
                }
                Err(e) => log::warn!("schedules: dropping schedule {}: {e}", schedule.id),
            }
        } else if !run {
            // A skipped one-off stays, paused, so the user sees it did not run.
            let mut skipped = schedule.clone();
            skipped.enabled = false;
            skipped.last_run_unix = Some(now);
            skipped.last_outcome = Some(RunOutcome::Skipped);
            skipped.last_error = None;
            kept.push(skipped);
        }
        schedule.last_run_unix = Some(now);
        due.push((schedule, run));
    }
    *list = kept;
    due
}

/// Queue one schedule's prompt into its target and start the drain. A
/// `NewSession` target gets a new session in the worktree first. Returns
/// the session the prompt went into.
async fn fire(app: &AppHandle, schedule: &Schedule) -> Result<String, String> {
    let worktree_path = resolve_worktree_path(app, &schedule.worktree_id)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "The worktree no longer exists".to_string())?;

    let session_id = match schedule.target {
        ScheduleTarget::Session => schedule.session_id.clone(),
        ScheduleTarget::NewSession => {
            let backend = schedule
                .template
                .as_ref()
                .and_then(|t| t.get("backend"))
                .and_then(Value::as_str)
                .map(str::to_string);
            super::commands::create_session(
                app.clone(),
                schedule.worktree_id.clone(),
                worktree_path.clone(),
                Some(new_session_name(schedule)),
                backend,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await?
            .id
        }
    };

    let queue = enqueue(app, schedule, &session_id).inspect_err(|e| {
        log::warn!("schedules::fire: failed to enqueue schedule for session={session_id}: {e}");
    })?;

    let _ = app.emit_all(
        "queue:updated",
        &serde_json::json!({ "sessionId": session_id, "queue": queue }),
    );
    super::commands::trigger_backend_queue_drain(
        app.clone(),
        schedule.worktree_id.clone(),
        worktree_path.clone(),
        session_id.clone(),
    );

    let _ = app.emit_all(
        "chat:wakeup_fired",
        &WakeupFiredEvent {
            session_id: session_id.clone(),
            worktree_id: schedule.worktree_id.clone(),
            worktree_path,
            prompt: schedule.prompt.clone(),
            tool_call_id: schedule.to_wakeup().tool_call_id,
            schedule_id: schedule.id.clone(),
        },
    );
    Ok(session_id)
}

/// Name of the session a `NewSession` run creates.
fn new_session_name(schedule: &Schedule) -> String {
    if !schedule.name.is_empty() {
        return schedule.name.clone();
    }
    let prompt: String = schedule.prompt.trim().chars().take(40).collect();
    format!("Scheduled: {prompt}")
}

/// Record how a fire went. A failed fire (session or worktree gone) pauses
/// the schedule and keeps it in the list, also a one-off, so the user sees
/// why it did not run and can fix or delete it.
fn record_fire(app: &AppHandle, schedule: &Schedule, result: Result<String, String>) {
    let _ = update(app, |list| {
        apply_fire_result(list, schedule, &result);
        (true, ())
    });
}

fn apply_fire_result(list: &mut Vec<Schedule>, fired: &Schedule, result: &Result<String, String>) {
    let index = match list.iter().position(|s| s.id == fired.id) {
        Some(index) => index,
        // A one-off that ran is done; one that failed comes back paused.
        None if result.is_err() => {
            list.push(fired.clone());
            list.len() - 1
        }
        None => return,
    };
    let schedule = &mut list[index];
    match result {
        Ok(session_id) => {
            schedule.last_session_id = Some(session_id.clone());
        }
        Err(e) => {
            log::warn!("schedules: schedule {} failed: {e}", schedule.id);
            schedule.last_outcome = Some(RunOutcome::Failed);
            schedule.last_error = Some(e.clone());
            schedule.enabled = false;
        }
    }
}

/// Append the schedule's prompt to the session's message queue.
/// A session that never sent a message gets its metadata here, as
/// `send_chat_message` would create it.
fn enqueue(app: &AppHandle, schedule: &Schedule, session_id: &str) -> Result<Vec<Value>, String> {
    let session = find_session(app, session_id)
        .ok()
        .filter(|s| !deleted_from_index(app, &s.worktree_id, session_id))
        .ok_or_else(|| "The session no longer exists".to_string())?;
    super::ensure_session_can_run(
        session_id,
        session.archived_at,
        &session.worktree_id,
        super::worktree_archived_at(app, &session.worktree_id),
    )?;
    storage::with_metadata_mut(
        app,
        session_id,
        &session.worktree_id,
        &session.name,
        session.order,
        |m| {
            let message = queued_message(m, schedule, now_unix());
            m.queued_messages.push(message);
            Ok(m.queued_messages.clone())
        },
    )
}

/// The worktree's session index lists every session, archived ones too.
/// A session missing from an existing index was deleted (archiving a
/// session that never sent deletes it), even when its metadata is left.
fn deleted_from_index(app: &AppHandle, worktree_id: &str, session_id: &str) -> bool {
    storage::get_index_path(app, worktree_id).is_ok_and(|path| path.exists())
        && storage::load_index(app, worktree_id)
            .is_ok_and(|index| !index.sessions.iter().any(|s| s.id == session_id))
}

/// Build a queued message (frontend `QueuedMessage` shape) for a fired
/// schedule: the session's saved selections, overlaid by the schedule's
/// `template` (the composer's toolbar settings, or the capped mode of an
/// agent schedule). Without a template, settings come only from the
/// session's saved selections; a setting the session never saved stays out, so
/// `send_chat_message` resolves it from the session and preferences instead
/// of a hard-coded default. `scheduleId` lets the drain report the run's end.
fn queued_message(metadata: &SessionMetadata, schedule: &Schedule, now: u64) -> Value {
    let mut message = session_settings(metadata);
    let fields = message.as_object_mut().expect("json object");
    if let Some(Value::Object(template)) = &schedule.template {
        for (key, value) in template {
            fields.insert(key.clone(), value.clone());
        }
    }
    fields.insert("id".into(), Value::from(uuid::Uuid::new_v4().to_string()));
    fields.insert("message".into(), Value::from(schedule.prompt.clone()));
    fields.insert("queuedAt".into(), Value::from(now.saturating_mul(1000)));
    fields.insert("scheduleId".into(), Value::from(schedule.id.clone()));
    for key in [
        "pendingImages",
        "pendingFiles",
        "pendingSkills",
        "pendingTextFiles",
    ] {
        fields
            .entry(key)
            .or_insert_with(|| Value::Array(Vec::new()));
    }
    message
}

/// The session's saved toolbar selections as queued-message fields.
fn session_settings(metadata: &SessionMetadata) -> Value {
    let mut message = serde_json::json!({
        "provider": metadata.selected_provider,
        "backend": metadata.backend,
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
                let mut schedule = Schedule::new(
                    ScheduleOrigin::Agent,
                    &metadata.id,
                    &metadata.worktree_id,
                    wakeup.prompt.clone(),
                    wakeup.fire_at_unix,
                    wakeup.scheduled_at_unix,
                );
                schedule.reason = wakeup.reason.clone();
                schedule.tool_call_id = Some(wakeup.tool_call_id.clone());
                list.push(schedule);
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

    fn create_simple(
        app: &RuntimeContext,
        session_id: &str,
        prompt: &str,
        fire_at_unix: Option<u64>,
        recurrence: Option<Recurrence>,
    ) -> Result<Schedule, String> {
        create(
            app,
            session_id,
            prompt,
            fire_at_unix,
            recurrence,
            ScheduleOptions::default(),
        )
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
        let schedule = create_simple(&app, "disk-1", "later", Some(4_000_000_000), None).unwrap();

        assert_eq!(on_disk(&app, "disk-1"), vec![schedule.clone()]);
        assert_eq!(of_session("disk-1"), vec![schedule]);
    }

    #[test]
    fn a_new_agent_wakeup_replaces_only_the_old_agent_wakeup() {
        let (_temp, app) = app();
        session(&app, "agent-1");
        let user =
            create_simple(&app, "agent-1", "user prompt", Some(4_000_000_000), None).unwrap();
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
        let later = create_simple(&app, "many-1", "second", Some(4_000_000_200), None).unwrap();
        let sooner = create_simple(&app, "many-1", "first", Some(4_000_000_100), None).unwrap();

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
        let keep = create_simple(&app, "delete-1", "keep", Some(4_000_000_000), None).unwrap();
        let drop = create_simple(&app, "delete-1", "drop", Some(4_000_000_000), None).unwrap();

        assert!(delete(&app, &drop.id).unwrap());
        assert!(!delete(&app, &drop.id).unwrap());
        assert_eq!(of_session("delete-1"), vec![keep.clone()]);
        assert_eq!(on_disk(&app, "delete-1"), vec![keep]);
    }

    #[test]
    fn cancel_session_removes_all_its_schedules() {
        let (_temp, app) = app();
        session(&app, "cancel-1");
        create_simple(&app, "cancel-1", "a", Some(4_000_000_000), None).unwrap();
        create_simple(&app, "cancel-1", "b", Some(4_000_000_000), None).unwrap();

        assert!(cancel_session(&app, "cancel-1").unwrap());
        assert!(of_session("cancel-1").is_empty());
    }

    // A fired schedule must land in the backend queue, so it runs with no
    // window open.
    #[test]
    fn a_fired_schedule_moves_into_the_message_queue() {
        let (_temp, app) = app();
        session(&app, "fire-1");
        let schedule = create_simple(&app, "fire-1", "check the build", Some(0), None).unwrap();

        let queue = enqueue(&app, &schedule, "fire-1").unwrap();

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
        let schedule = repeating("q", 0);
        let bare = queued_message(&metadata, &schedule, 7);
        assert!(bare.get("model").is_none());
        assert!(bare.get("executionMode").is_none());
        assert!(bare.get("thinkingLevel").is_none());
        assert_eq!(bare["queuedAt"], 7000);

        metadata.selected_model = Some("claude-opus-4-8".into());
        metadata.selected_execution_mode = Some("plan".into());
        let saved = queued_message(&metadata, &schedule, 7);
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
        let mut schedule =
            Schedule::new(ScheduleOrigin::User, "s", "w", "p".into(), fire_at_unix, 0);
        schedule.id = id.into();
        schedule.recurrence = Some(daily_9_berlin());
        schedule
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
    fn a_skipped_one_off_stays_paused() {
        let now = unix("2026-10-26T12:00:00Z");
        let mut one_off = repeating("once", unix("2026-10-26T09:00:00Z"));
        one_off.recurrence = None;

        let mut list = vec![one_off.clone()];
        let due = take_due(&mut list, now, true);
        assert!(!due[0].1);
        assert_eq!(list.len(), 1);
        assert!(!list[0].enabled);
        assert_eq!(list[0].last_outcome, Some(RunOutcome::Skipped));
        assert_eq!(list[0].last_run_unix, Some(now));

        let mut list = vec![one_off];
        take_due(&mut list, now, false);
        assert!(list.is_empty());
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
        let schedule =
            create_simple(&app, "repeat-1", "daily", None, Some(daily_9_berlin())).unwrap();
        assert!(schedule.fire_at_unix > now_unix());
        assert_eq!(
            schedule.fire_at_unix,
            next_occurrence(&daily_9_berlin(), schedule.created_at_unix).unwrap()
        );
    }

    // The composer's toolbar snapshot wins over the session's saved
    // settings; the prompt and a fresh id always come from the schedule.
    #[test]
    fn a_template_carries_the_composer_settings() {
        let mut metadata = SessionMetadata::new("s1".into(), "w1".into(), "Session".into(), 0);
        metadata.selected_model = Some("saved-model".into());
        let mut schedule = repeating("tpl", 0);
        schedule.prompt = "run the checks".into();
        schedule.template = Some(serde_json::json!({
            "id": "old",
            "message": "stale",
            "model": "claude-fable-5",
            "backend": "claude",
            "executionMode": "yolo",
            "mcpConfig": "{}",
            "pendingFiles": [{ "id": "f", "relativePath": "a.rs" }],
        }));

        let message = queued_message(&metadata, &schedule, 7);

        assert_eq!(message["model"], "claude-fable-5");
        assert_eq!(message["executionMode"], "yolo");
        assert_eq!(message["mcpConfig"], "{}");
        assert_eq!(message["message"], "run the checks");
        assert_eq!(message["scheduleId"], "tpl");
        assert_ne!(message["id"], "old");
        assert_eq!(message["pendingFiles"].as_array().unwrap().len(), 1);
        assert_eq!(message["pendingImages"], serde_json::json!([]));
    }

    #[test]
    fn a_paused_schedule_does_not_fire() {
        let mut paused = repeating("paused", 100);
        paused.enabled = false;
        let mut list = vec![paused];

        assert!(take_due(&mut list, 10_000, false).is_empty());
        assert_eq!(list[0].fire_at_unix, 100);
    }

    // A one-off whose session is gone must not vanish: it comes back
    // paused with the reason, so the Scheduled view can show it.
    #[test]
    fn a_failed_one_off_comes_back_paused() {
        let mut one_off = repeating("gone", 100);
        one_off.recurrence = None;
        let mut list = Vec::new();

        apply_fire_result(
            &mut list,
            &one_off,
            &Err("The session no longer exists".into()),
        );

        assert_eq!(list.len(), 1);
        assert!(!list[0].enabled);
        assert_eq!(list[0].last_outcome, Some(RunOutcome::Failed));
        assert_eq!(
            list[0].last_error.as_deref(),
            Some("The session no longer exists")
        );
    }

    #[test]
    fn a_repeating_run_records_its_session() {
        let mut list = vec![repeating("rep", 10_000)];
        let fired = list[0].clone();
        apply_fire_result(&mut list, &fired, &Ok("new-session".into()));
        assert_eq!(list[0].last_session_id.as_deref(), Some("new-session"));
        assert!(list[0].enabled);
    }

    // Older schedules.json files have none of the new fields.
    #[test]
    fn an_old_schedule_file_still_loads() {
        let old = serde_json::json!({
            "id": "x", "origin": "user", "session_id": "s", "worktree_id": "w",
            "prompt": "p", "fire_at_unix": 1, "created_at_unix": 0
        });
        let schedule: Schedule = serde_json::from_value(old).unwrap();
        assert!(schedule.enabled);
        assert_eq!(schedule.target, ScheduleTarget::Session);
        assert!(schedule.template.is_none());
    }

    #[test]
    fn create_keeps_the_target_template_and_name() {
        let (_temp, app) = app();
        session(&app, "opts-1");
        let schedule = create(
            &app,
            "opts-1",
            "nightly",
            None,
            Some(daily_9_berlin()),
            ScheduleOptions {
                name: Some("  Nightly check ".into()),
                target: ScheduleTarget::NewSession,
                template: Some(serde_json::json!({ "model": "m" })),
            },
        )
        .unwrap();
        assert_eq!(schedule.name, "Nightly check");
        assert_eq!(schedule.target, ScheduleTarget::NewSession);
        assert_eq!(schedule.template, Some(serde_json::json!({ "model": "m" })));
        assert_eq!(on_disk(&app, "opts-1"), vec![schedule]);
    }

    #[test]
    fn resume_moves_a_repeating_schedule_past_now() {
        let now = unix("2026-10-26T12:00:00Z");
        let mut schedule = repeating("resume", unix("2026-10-20T07:00:00Z"));
        apply_enabled(&mut schedule, false, now);
        assert!(!schedule.enabled);

        schedule.last_error = Some("old".into());
        apply_enabled(&mut schedule, true, now);
        assert!(schedule.enabled);
        assert!(schedule.last_error.is_none());
        assert_eq!(schedule.fire_at_unix, unix("2026-10-27T08:00:00Z"));

        let mut one_off = repeating("resume-once", 100);
        one_off.recurrence = None;
        apply_enabled(&mut one_off, true, now);
        assert_eq!(one_off.fire_at_unix, now);
    }

    #[test]
    fn edit_changes_prompt_target_and_time() {
        let (_temp, app) = app();
        session(&app, "edit-1");
        let once = create_simple(&app, "edit-1", "old", Some(4_000_000_000), None).unwrap();
        let edited = edit(
            &app,
            &once.id,
            ScheduleEdit {
                prompt: " new prompt ".into(),
                name: "Renamed".into(),
                target: ScheduleTarget::NewSession,
                fire_at_unix: Some(4_000_000_500),
                // Ignored: a one-off stays a one-off.
                recurrence: Some(daily_9_berlin()),
            },
        )
        .unwrap();
        assert_eq!(edited.prompt, "new prompt");
        assert_eq!(edited.name, "Renamed");
        assert_eq!(edited.target, ScheduleTarget::NewSession);
        assert_eq!(edited.fire_at_unix, 4_000_000_500);
        assert!(edited.recurrence.is_none());
        assert_eq!(on_disk(&app, "edit-1"), vec![edited]);

        assert!(edit(
            &app,
            "missing",
            ScheduleEdit {
                prompt: "p".into(),
                ..Default::default()
            }
        )
        .is_err());
    }

    #[test]
    fn edit_changes_a_repeat_rule() {
        let (_temp, app) = app();
        session(&app, "edit-2");
        let daily = create_simple(&app, "edit-2", "d", None, Some(daily_9_berlin())).unwrap();
        let weekly = Recurrence {
            cron: "0 9 * * 1".into(),
            tz: "Europe/Berlin".into(),
        };
        let edited = edit(
            &app,
            &daily.id,
            ScheduleEdit {
                prompt: "d".into(),
                recurrence: Some(weekly.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(edited.recurrence, Some(weekly));
    }

    #[test]
    fn an_agent_never_raises_the_mode() {
        assert_eq!(capped_mode(Some("plan"), Some("yolo")), "plan");
        assert_eq!(capped_mode(Some("yolo"), Some("build")), "build");
        assert_eq!(capped_mode(Some("yolo"), Some("yolo")), "yolo");
        assert_eq!(capped_mode(Some("build"), None), "build");
        assert_eq!(capped_mode(None, Some("yolo")), "yolo");
        assert_eq!(capped_mode(None, None), "plan");
    }

    #[test]
    fn an_agent_schedule_runs_in_the_lower_mode() {
        let (_temp, app) = app();
        storage::with_metadata_mut(&app, "agent-caller", "w1", "Caller", 0, |m| {
            m.selected_execution_mode = Some("build".into());
            Ok(())
        })
        .unwrap();
        storage::with_metadata_mut(&app, "agent-target", "w1", "Target", 0, |m| {
            m.selected_execution_mode = Some("yolo".into());
            m.selected_model = Some("saved-model".into());
            Ok(())
        })
        .unwrap();

        let schedule = create_for_agent(
            &app,
            AgentScheduleRequest {
                caller_session_id: Some("agent-caller".into()),
                session_id: Some("agent-target".into()),
                prompt: "check later".into(),
                fire_at_unix: Some(4_000_000_000),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(schedule.origin, ScheduleOrigin::Agent);
        assert_eq!(schedule.target, ScheduleTarget::Session);
        assert_eq!(schedule.session_id, "agent-target");
        let metadata = storage::load_metadata(&app, "agent-target")
            .unwrap()
            .unwrap();
        let message = queued_message(&metadata, &schedule, 1);
        // Capped to the caller's build; the target's model is kept.
        assert_eq!(message["executionMode"], "build");
        assert_eq!(message["model"], "saved-model");
    }

    #[test]
    fn an_agent_schedule_needs_a_future_time_and_a_target() {
        let (_temp, app) = app();
        let past = create_for_agent(
            &app,
            AgentScheduleRequest {
                session_id: Some("nobody".into()),
                prompt: "p".into(),
                fire_at_unix: Some(1),
                ..Default::default()
            },
        );
        assert!(past.unwrap_err().contains("past"));
        let no_target = create_for_agent(
            &app,
            AgentScheduleRequest {
                prompt: "p".into(),
                fire_at_unix: Some(4_000_000_000),
                ..Default::default()
            },
        );
        assert!(no_target.is_err());
    }

    #[test]
    fn a_failed_send_is_recorded_and_keeps_the_schedule_on() {
        let (_temp, app) = app();
        session(&app, "send-fail");
        let daily = create_simple(&app, "send-fail", "d", None, Some(daily_9_berlin())).unwrap();

        scheduled_run_finished(&app, &daily.id, "send-fail", "w1", Some("model retired"));

        let stored = of_session("send-fail").pop().unwrap();
        assert!(stored.enabled);
        assert_eq!(stored.last_outcome, Some(RunOutcome::Failed));
        assert_eq!(stored.last_error.as_deref(), Some("model retired"));
    }

    // A session that never sent a message exists only in its worktree
    // index; scheduling into it must work and the fire creates its metadata.
    #[test]
    fn a_never_sent_session_can_be_scheduled_and_fired() {
        let (_temp, app) = app();
        let index = storage::load_index(&app, "fresh-wt").unwrap();
        let session_id = index.sessions[0].id.clone();
        assert!(storage::load_metadata(&app, &session_id).unwrap().is_none());

        let schedule =
            create_simple(&app, &session_id, "first prompt", Some(4_000_000_000), None).unwrap();
        assert_eq!(schedule.worktree_id, "fresh-wt");

        let queue = enqueue(&app, &schedule, &session_id).unwrap();
        assert_eq!(queue[0]["message"], "first prompt");
        let metadata = storage::load_metadata(&app, &session_id).unwrap().unwrap();
        assert_eq!(metadata.worktree_id, "fresh-wt");
        assert_eq!(metadata.name, "Session 1");
    }

    #[test]
    fn a_deleted_session_is_not_brought_back() {
        // Archiving a session that never sent deletes it from the index, but
        // its metadata stays on disk.
        let (_temp, app) = app();
        session(&app, "deleted-1");
        let schedule =
            create_simple(&app, "deleted-1", "later", Some(4_000_000_000), None).unwrap();
        storage::load_index(&app, "w1").unwrap();

        assert_eq!(
            enqueue(&app, &schedule, "deleted-1").unwrap_err(),
            "The session no longer exists"
        );
        let metadata = storage::load_metadata(&app, "deleted-1").unwrap().unwrap();
        assert!(metadata.queued_messages.is_empty());
    }

    #[test]
    fn a_paused_schedule_does_not_mark_the_session_scheduled() {
        let (_temp, app) = app();
        session(&app, "paused-mark-1");
        let schedule =
            create_simple(&app, "paused-mark-1", "later", Some(4_000_000_000), None).unwrap();
        assert!(next_wakeup_for_session("paused-mark-1").is_some());

        set_enabled(&app, &schedule.id, false).unwrap();
        assert!(next_wakeup_for_session("paused-mark-1").is_none());
    }
}
