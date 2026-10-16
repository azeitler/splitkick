//! ScheduleWakeup support — persists and fires delayed prompts requested
//! by Claude CLI via the `ScheduleWakeup` tool call.
//!
//! Flow:
//! 1. Claude stream handler detects tool_use with `name == "ScheduleWakeup"`
//!    and calls `schedule_from_tool_input()`.
//! 2. The scheduler clamps `delaySeconds` to [60, 3600], persists a
//!    `ScheduledWakeup` on `SessionMetadata`, and inserts an entry into
//!    an in-memory `BTreeMap<fire_at_unix, ...>` for O(log n) polling.
//! 3. `BackgroundTaskManager` calls `fire_due()` every 10 s. A fired entry
//!    is moved from `scheduled_wakeup` into the session's message queue in
//!    one metadata write, and the Rust queue drain sends it. No window has
//!    to be open. `chat:wakeup_fired` only tells clients to update the UI.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::storage;
use super::types::{ScheduledWakeup, SessionMetadata};
use crate::http_server::EmitExt;

const MIN_DELAY_SECS: u64 = 60;
const MAX_DELAY_SECS: u64 = 3600;

/// Entry stored in the in-memory scheduler map.
#[derive(Debug, Clone)]
struct WakeupEntry {
    session_id: String,
    worktree_id: String,
    tool_call_id: String,
    prompt: String,
    #[allow(dead_code)]
    reason: String,
    #[allow(dead_code)]
    delay_seconds: u64,
    #[allow(dead_code)]
    scheduled_at_unix: u64,
}

/// Key = fire_at_unix; value = list of entries firing at that second.
/// Ties broken by insertion order within the vec.
type WakeupMap = BTreeMap<u64, Vec<WakeupEntry>>;

static SCHEDULER: Lazy<Mutex<WakeupMap>> = Lazy::new(|| Mutex::new(BTreeMap::new()));

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Payload broadcast to the frontend when a wakeup fires.
#[derive(Debug, Clone, Serialize)]
pub struct WakeupFiredEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub worktree_path: String,
    pub prompt: String,
    pub tool_call_id: String,
}

/// Payload broadcast when a wakeup is newly scheduled (for UI countdown).
#[derive(Debug, Clone, Serialize)]
pub struct WakeupScheduledEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub wakeup: ScheduledWakeup,
}

/// Payload broadcast when a wakeup is cancelled.
#[derive(Debug, Clone, Serialize)]
pub struct WakeupCancelledEvent {
    pub session_id: String,
    pub worktree_id: String,
    pub tool_call_id: Option<String>,
}

/// Extract scheduling parameters from a `ScheduleWakeup` tool_use input and persist.
/// Returns the resolved `ScheduledWakeup` on success.
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

    let scheduled_at_unix = now_unix();
    let fire_at_unix = scheduled_at_unix.saturating_add(delay_seconds);
    let wakeup = ScheduledWakeup {
        fire_at_unix,
        scheduled_at_unix,
        delay_seconds,
        prompt: prompt.clone(),
        reason: reason.clone(),
        tool_call_id: tool_call_id.to_string(),
    };

    schedule(app, session_id, worktree_id, wakeup.clone())?;
    Ok(wakeup)
}

/// Persist + register a wakeup. Overwrites any prior wakeup on the session
/// (last-wins, matches `/loop` semantics where each call replaces the tick).
pub fn schedule(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
    wakeup: ScheduledWakeup,
) -> Result<(), String> {
    storage::with_existing_metadata_mut(app, session_id, |m| {
        m.scheduled_wakeup = Some(wakeup.clone());
    })?;

    {
        let mut map = SCHEDULER.lock().unwrap();
        remove_entries_for_session(&mut map, session_id);
        map.entry(wakeup.fire_at_unix)
            .or_default()
            .push(WakeupEntry {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                tool_call_id: wakeup.tool_call_id.clone(),
                prompt: wakeup.prompt.clone(),
                reason: wakeup.reason.clone(),
                delay_seconds: wakeup.delay_seconds,
                scheduled_at_unix: wakeup.scheduled_at_unix,
            });
    }

    let _ = app.emit(
        "chat:wakeup_scheduled",
        &WakeupScheduledEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            wakeup,
        },
    );

    Ok(())
}

/// Cancel any pending wakeup for a session (user action or system cleanup).
pub fn cancel(app: &AppHandle, session_id: &str) -> Result<Option<ScheduledWakeup>, String> {
    let cleared =
        storage::with_existing_metadata_mut(app, session_id, |m| m.scheduled_wakeup.take())?;

    let worktree_id_hint = {
        let mut map = SCHEDULER.lock().unwrap();
        let hint = map
            .values()
            .flat_map(|v| v.iter())
            .find(|e| e.session_id == session_id)
            .map(|e| e.worktree_id.clone());
        remove_entries_for_session(&mut map, session_id);
        hint
    };

    if let Some(wakeup) = &cleared {
        let worktree_id = worktree_id_hint.unwrap_or_default();
        let _ = app.emit(
            "chat:wakeup_cancelled",
            &WakeupCancelledEvent {
                session_id: session_id.to_string(),
                worktree_id,
                tool_call_id: Some(wakeup.tool_call_id.clone()),
            },
        );
    }

    Ok(cleared)
}

/// Drop entries for a specific session from the in-memory map.
fn remove_entries_for_session(map: &mut WakeupMap, session_id: &str) {
    let mut empty_keys: Vec<u64> = Vec::new();
    for (key, list) in map.iter_mut() {
        list.retain(|e| e.session_id != session_id);
        if list.is_empty() {
            empty_keys.push(*key);
        }
    }
    for key in empty_keys {
        map.remove(&key);
    }
}

/// Drain all entries whose `fire_at_unix <= now_unix`. For each, move the
/// persisted wakeup into the session's message queue, start the backend
/// queue drain and emit `chat:wakeup_fired` for the UI.
///
/// Called by BackgroundTaskManager every ~10 s.
pub fn fire_due(app: &AppHandle) {
    let now = now_unix();
    let due: Vec<WakeupEntry> = {
        let mut map = SCHEDULER.lock().unwrap();
        let due_keys: Vec<u64> = map.range(..=now).map(|(k, _)| *k).collect();
        let mut out = Vec::new();
        for k in due_keys {
            if let Some(list) = map.remove(&k) {
                out.extend(list);
            }
        }
        out
    };

    if due.is_empty() {
        return;
    }

    log::info!("wakeup::fire_due: firing {} wakeup(s)", due.len());

    for entry in due {
        let worktree_path = resolve_worktree_path(app, &entry.worktree_id).unwrap_or_default();
        if worktree_path.is_empty() {
            log::warn!(
                "wakeup::fire_due: cannot resolve worktree_path for worktree_id={}, skipping",
                entry.worktree_id
            );
            continue;
        }

        let queue = match enqueue_wakeup(app, &entry) {
            Ok(Some(queue)) => queue,
            // A newer wakeup replaced this one; it fires on its own.
            Ok(None) => continue,
            Err(e) => {
                log::warn!(
                    "wakeup::fire_due: failed to enqueue wakeup for session={}: {e}",
                    entry.session_id
                );
                continue;
            }
        };

        let _ = app.emit_all(
            "queue:updated",
            &serde_json::json!({ "sessionId": entry.session_id, "queue": queue }),
        );
        super::commands::trigger_backend_queue_drain(
            app.clone(),
            entry.worktree_id.clone(),
            worktree_path.clone(),
            entry.session_id.clone(),
        );

        let _ = app.emit(
            "chat:wakeup_fired",
            &WakeupFiredEvent {
                session_id: entry.session_id.clone(),
                worktree_id: entry.worktree_id.clone(),
                worktree_path,
                prompt: entry.prompt.clone(),
                tool_call_id: entry.tool_call_id.clone(),
            },
        );
    }
}

/// Clear the persisted wakeup and append its prompt to the message queue in
/// one metadata write, so a crash cannot lose the prompt in between.
/// Returns the new queue, or `None` when the persisted wakeup is no longer
/// this entry (a newer schedule replaced it).
fn enqueue_wakeup(app: &AppHandle, entry: &WakeupEntry) -> Result<Option<Vec<Value>>, String> {
    storage::with_existing_metadata_mut(app, &entry.session_id, |m| {
        let matches = m
            .scheduled_wakeup
            .as_ref()
            .is_some_and(|w| w.tool_call_id == entry.tool_call_id);
        if !matches {
            return None;
        }
        m.scheduled_wakeup = None;
        let message = wakeup_queued_message(m, &entry.prompt, now_unix());
        m.queued_messages.push(message);
        Some(m.queued_messages.clone())
    })
}

/// Build a queued message (frontend `QueuedMessage` shape) for a fired
/// wakeup. Settings come only from the session's saved selections; a setting
/// the session never saved stays out, so `send_chat_message` resolves it
/// from the session and preferences instead of a hard-coded default.
fn wakeup_queued_message(metadata: &SessionMetadata, prompt: &str, now: u64) -> Value {
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

/// Load every persisted `ScheduledWakeup` from disk and repopulate the
/// in-memory map. Called once at app startup.
///
/// Entries whose `fire_at_unix <= now` remain in the map and will fire on
/// the next `fire_due()` poll tick — giving the frontend a moment to
/// subscribe before events land.
pub fn load_all_from_disk(app: &AppHandle) -> Result<usize, String> {
    let data_dir = storage::get_data_dir(app)?;
    let read_dir = match std::fs::read_dir(&data_dir) {
        Ok(d) => d,
        Err(_) => return Ok(0),
    };

    let mut loaded = 0usize;
    let mut map = SCHEDULER.lock().unwrap();
    map.clear();

    for entry in read_dir.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let session_id = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let metadata = match storage::load_metadata(app, &session_id) {
            Ok(Some(m)) => m,
            _ => continue,
        };
        let Some(w) = metadata.scheduled_wakeup.clone() else {
            continue;
        };
        map.entry(w.fire_at_unix).or_default().push(WakeupEntry {
            session_id: metadata.id.clone(),
            worktree_id: metadata.worktree_id.clone(),
            tool_call_id: w.tool_call_id.clone(),
            prompt: w.prompt.clone(),
            reason: w.reason.clone(),
            delay_seconds: w.delay_seconds,
            scheduled_at_unix: w.scheduled_at_unix,
        });
        loaded += 1;
    }

    log::info!("wakeup::load_all_from_disk: loaded {loaded} pending wakeup(s)");
    Ok(loaded)
}

/// Get the pending wakeup for a session (UI hydration).
pub fn get_for_session(
    app: &AppHandle,
    session_id: &str,
) -> Result<Option<ScheduledWakeup>, String> {
    Ok(storage::load_metadata(app, session_id)?.and_then(|m| m.scheduled_wakeup))
}

/// Entry returned by `list_pending`: session context + wakeup payload.
#[derive(Debug, Clone, Serialize)]
pub struct PendingWakeupEntry {
    pub session_id: String,
    pub worktree_id: String,
    pub wakeup: ScheduledWakeup,
}

/// Return all currently-pending wakeups from the in-memory map. Used by the
/// frontend on mount to hydrate the store so reloads do not leave historical
/// ScheduleWakeup tool_use blocks stuck in the "pending" spinner state.
pub fn list_pending() -> Vec<PendingWakeupEntry> {
    let map = SCHEDULER.lock().unwrap();
    let mut out = Vec::new();
    for (fire_at, list) in map.iter() {
        for e in list {
            out.push(PendingWakeupEntry {
                session_id: e.session_id.clone(),
                worktree_id: e.worktree_id.clone(),
                wakeup: ScheduledWakeup {
                    fire_at_unix: *fire_at,
                    scheduled_at_unix: e.scheduled_at_unix,
                    delay_seconds: e.delay_seconds,
                    prompt: e.prompt.clone(),
                    reason: e.reason.clone(),
                    tool_call_id: e.tool_call_id.clone(),
                },
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clamp_min() {
        let v = json!({ "delaySeconds": 10u64, "prompt": "x" });
        assert_eq!(v.get("delaySeconds").and_then(|d| d.as_u64()).unwrap(), 10);
        let clamped = (10u64).clamp(MIN_DELAY_SECS, MAX_DELAY_SECS);
        assert_eq!(clamped, MIN_DELAY_SECS);
    }

    #[test]
    fn clamp_max() {
        let clamped = (100_000u64).clamp(MIN_DELAY_SECS, MAX_DELAY_SECS);
        assert_eq!(clamped, MAX_DELAY_SECS);
    }

    #[test]
    fn map_remove_for_session() {
        let mut map: WakeupMap = BTreeMap::new();
        map.entry(100).or_default().push(WakeupEntry {
            session_id: "s1".into(),
            worktree_id: "w1".into(),
            tool_call_id: "t1".into(),
            prompt: "p".into(),
            reason: "r".into(),
            delay_seconds: 60,
            scheduled_at_unix: 40,
        });
        map.entry(100).or_default().push(WakeupEntry {
            session_id: "s2".into(),
            worktree_id: "w1".into(),
            tool_call_id: "t2".into(),
            prompt: "p".into(),
            reason: "r".into(),
            delay_seconds: 60,
            scheduled_at_unix: 40,
        });
        remove_entries_for_session(&mut map, "s1");
        assert_eq!(map.get(&100).unwrap().len(), 1);
        remove_entries_for_session(&mut map, "s2");
        assert!(!map.contains_key(&100));
    }

    fn entry(session_id: &str, tool_call_id: &str) -> WakeupEntry {
        WakeupEntry {
            session_id: session_id.into(),
            worktree_id: "w1".into(),
            tool_call_id: tool_call_id.into(),
            prompt: "check the build".into(),
            reason: String::new(),
            delay_seconds: 60,
            scheduled_at_unix: 40,
        }
    }

    fn wakeup(tool_call_id: &str) -> ScheduledWakeup {
        ScheduledWakeup {
            fire_at_unix: 100,
            scheduled_at_unix: 40,
            delay_seconds: 60,
            prompt: "check the build".into(),
            reason: String::new(),
            tool_call_id: tool_call_id.into(),
        }
    }

    // A fired wakeup must land in the backend queue, so it runs with no
    // window open. The old path only emitted an event and lost the prompt
    // when no frontend listened.
    #[test]
    fn a_fired_wakeup_moves_into_the_message_queue() {
        let temp = tempfile::tempdir().unwrap();
        let app =
            crate::runtime::RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        storage::with_metadata_mut(&app, "s1", "w1", "Session", 0, |m| {
            m.scheduled_wakeup = Some(wakeup("t1"));
            Ok(())
        })
        .unwrap();

        let queue = enqueue_wakeup(&app, &entry("s1", "t1")).unwrap().unwrap();

        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0]["message"], "check the build");
        let metadata = storage::load_metadata(&app, "s1").unwrap().unwrap();
        assert!(metadata.scheduled_wakeup.is_none());
        assert_eq!(metadata.queued_messages, queue);
    }

    #[test]
    fn a_replaced_wakeup_does_not_enqueue() {
        let temp = tempfile::tempdir().unwrap();
        let app =
            crate::runtime::RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        storage::with_metadata_mut(&app, "s1", "w1", "Session", 0, |m| {
            m.scheduled_wakeup = Some(wakeup("t2"));
            Ok(())
        })
        .unwrap();

        assert!(enqueue_wakeup(&app, &entry("s1", "t1")).unwrap().is_none());
        let metadata = storage::load_metadata(&app, "s1").unwrap().unwrap();
        assert_eq!(metadata.scheduled_wakeup, Some(wakeup("t2")));
        assert!(metadata.queued_messages.is_empty());
    }

    // No hard-coded model or mode: an unset setting stays out so the send
    // resolves it from the session, never as 'sonnet' / 'yolo'.
    #[test]
    fn the_queued_message_only_carries_saved_session_settings() {
        let mut metadata = SessionMetadata::new("s1".into(), "w1".into(), "Session".into(), 0);
        let bare = wakeup_queued_message(&metadata, "p", 7);
        assert!(bare.get("model").is_none());
        assert!(bare.get("executionMode").is_none());
        assert!(bare.get("thinkingLevel").is_none());
        assert_eq!(bare["queuedAt"], 7000);

        metadata.selected_model = Some("claude-opus-4-8".into());
        metadata.selected_execution_mode = Some("plan".into());
        let saved = wakeup_queued_message(&metadata, "p", 7);
        assert_eq!(saved["model"], "claude-opus-4-8");
        assert_eq!(saved["executionMode"], "plan");
    }
}
