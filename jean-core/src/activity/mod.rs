//! Append-only activity log.
//!
//! Jean writes one record at the moment an event happens: a run ends, a commit
//! is made, a pull request is opened or merged, a review completes. The Home
//! view reads the newest records back.
//!
//! This is a real event log, not a guess made from the current state of a
//! session. Session and worktree records only keep the latest value, so they
//! cannot answer "what happened, and when".
//!
//! Storage is one JSON object per line in the app data directory. Appending is
//! cheap and safe against a crash: a torn last line is skipped on read. The
//! file is trimmed to [`MAX_EVENTS`] when it grows past [`TRIM_TRIGGER`].

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::http_server::EmitExt;

/// Log file name for the default flavor.
const ACTIVITY_FILE: &str = "activity.jsonl";
/// Log file name for the JeanZ flavor, so the two do not share history.
const ACTIVITY_FILE_JEANZ: &str = "activity_jeanz.jsonl";

/// Records kept after a trim.
const MAX_EVENTS: usize = 500;
/// Line count that starts a trim. The gap to [`MAX_EVENTS`] stops the log from
/// being rewritten on every append once it is full.
const TRIM_TRIGGER: usize = 750;

/// Event emitted after a record is appended, so open views can refresh.
pub const ACTIVITY_APPENDED_EVENT: &str = "activity:appended";

/// What happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    /// An agent run finished on its own.
    SessionCompleted,
    /// The user stopped an agent run.
    SessionCancelled,
    /// An agent run died.
    SessionCrashed,
    /// A commit was created.
    CommitCreated,
    /// A pull request was opened.
    PrOpened,
    /// A pull request was merged.
    PrMerged,
    /// A pull request was closed without a merge.
    PrClosed,
    /// An AI code review finished.
    ReviewFinished,
}

/// One entry in the activity log.
///
/// Names are copied in at write time. A later rename or delete must not turn an
/// old entry into a blank row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    /// Unique record id.
    pub id: String,
    pub kind: ActivityKind,
    /// Unix timestamp in seconds.
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    /// Short line shown in the feed, e.g. a commit subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Link to open, e.g. a pull request URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Set by [`record_once`]. Stable identity of a state that Jean observes by
    /// polling, so the same state is never logged twice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedupe_key: Option<String>,
}

/// A new record with only the fields the caller knows.
///
/// [`record`] fills in the project and worktree names from the worktree id.
#[derive(Debug, Clone, Default)]
pub struct NewActivity {
    pub worktree_id: Option<String>,
    /// Set instead of `worktree_id` by callers that only hold a path. The
    /// worktree is then found by path.
    pub worktree_path: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub dedupe_key: Option<String>,
}

impl NewActivity {
    pub fn for_worktree(worktree_id: impl Into<String>) -> Self {
        Self {
            worktree_id: Some(worktree_id.into()),
            ..Default::default()
        }
    }

    pub fn for_worktree_path(worktree_path: impl Into<String>) -> Self {
        Self {
            worktree_path: Some(worktree_path.into()),
            ..Default::default()
        }
    }

    pub fn session(mut self, id: impl Into<String>, name: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self.session_name = Some(name.into());
        self
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    pub fn dedupe_key(mut self, key: impl Into<String>) -> Self {
        self.dedupe_key = Some(key.into());
        self
    }
}

/// The first non-empty line of `text`, trimmed and capped, for a feed row.
///
/// Commit and review messages are multi-line. The feed shows one line.
pub fn first_line(text: &str) -> String {
    const MAX_CHARS: usize = 120;
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if line.chars().count() <= MAX_CHARS {
        return line.to_string();
    }
    let head: String = line.chars().take(MAX_CHARS).collect();
    format!("{head}\u{2026}")
}

fn activity_file_name(product_name: Option<&str>) -> &'static str {
    match product_name {
        Some(crate::PRODUCT_NAME_JEANZ) => ACTIVITY_FILE_JEANZ,
        _ => ACTIVITY_FILE,
    }
}

fn activity_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    Ok(dir.join(activity_file_name(app.product_name())))
}

fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Parse a log body. Lines that do not parse are skipped, so a torn write or a
/// record from a newer version cannot make the whole log unreadable.
fn parse_events(reader: impl BufRead) -> Vec<ActivityEvent> {
    reader
        .lines()
        .map_while(Result::ok)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<ActivityEvent>(&line).ok())
        .collect()
}

fn read_events(path: &PathBuf) -> Vec<ActivityEvent> {
    match std::fs::File::open(path) {
        Ok(file) => parse_events(BufReader::new(file)),
        Err(_) => Vec::new(),
    }
}

fn count_lines(path: &PathBuf) -> usize {
    match std::fs::File::open(path) {
        Ok(file) => BufReader::new(file).lines().map_while(Result::ok).count(),
        Err(_) => 0,
    }
}

/// Rewrite the log with only the newest [`MAX_EVENTS`] records.
fn trim(path: &PathBuf) -> Result<(), String> {
    let events = read_events(path);
    if events.len() <= MAX_EVENTS {
        return Ok(());
    }
    let keep = &events[events.len() - MAX_EVENTS..];

    let body = keep
        .iter()
        .filter_map(|event| serde_json::to_string(event).ok())
        .collect::<Vec<_>>()
        .join("\n");

    let temp = path.with_extension(format!("jsonl.tmp{}", std::process::id()));
    std::fs::write(&temp, format!("{body}\n"))
        .map_err(|e| format!("Failed to write activity log: {e}"))?;
    std::fs::rename(&temp, path).map_err(|e| format!("Failed to replace activity log: {e}"))
}

/// The project and worktree a record belongs to, resolved at write time.
#[derive(Debug, Default)]
struct ActivityContext {
    project_id: Option<String>,
    project_name: Option<String>,
    worktree_id: Option<String>,
    worktree_name: Option<String>,
    worktree_path: Option<String>,
}

/// Find the project and worktree, by id when the caller has one, otherwise by
/// path.
fn resolve_context(
    app: &AppHandle,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
) -> Option<ActivityContext> {
    let data = crate::projects::storage::load_projects_data(app).ok()?;
    let worktree = match worktree_id {
        Some(id) => data.find_worktree(id)?,
        None => {
            let path = worktree_path?;
            data.worktrees.iter().find(|w| w.path == path)?
        }
    };
    let project_name = data
        .find_project(&worktree.project_id)
        .map(|project| project.name.clone());

    Some(ActivityContext {
        project_id: Some(worktree.project_id.clone()),
        project_name,
        worktree_id: Some(worktree.id.clone()),
        worktree_name: Some(worktree.name.clone()),
        worktree_path: Some(worktree.path.clone()),
    })
}

/// Append one record. Best effort: a failure is logged and swallowed, because
/// losing a feed row must never fail the commit or the run that caused it.
pub fn record(app: &AppHandle, kind: ActivityKind, new: NewActivity) {
    if let Err(e) = try_record(app, kind, new) {
        log::warn!("[Activity] failed to record {kind:?}: {e}");
    }
}

fn try_record(app: &AppHandle, kind: ActivityKind, new: NewActivity) -> Result<(), String> {
    // A deleted worktree leaves the record without context rather than
    // dropping it, so the feed keeps the entry.
    let context = resolve_context(
        app,
        new.worktree_id.as_deref(),
        new.worktree_path.as_deref(),
    )
    .unwrap_or_default();

    let event = ActivityEvent {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        at: now_timestamp(),
        project_id: context.project_id,
        project_name: context.project_name,
        worktree_id: context.worktree_id.or(new.worktree_id),
        worktree_name: context.worktree_name,
        worktree_path: context.worktree_path.or(new.worktree_path),
        session_id: new.session_id,
        session_name: new.session_name,
        title: new.title,
        url: new.url,
        dedupe_key: new.dedupe_key,
    };

    append_event(&activity_path(app)?, &event)?;

    let _ = app.emit_all(ACTIVITY_APPENDED_EVENT, &event);
    Ok(())
}

/// Append one record to `path` and trim the file when it has grown too long.
fn append_event(path: &PathBuf, event: &ActivityEvent) -> Result<(), String> {
    let line = serde_json::to_string(event)
        .map_err(|e| format!("Failed to serialize activity event: {e}"))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Failed to open activity log: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Failed to append activity log: {e}"))?;
    drop(file);

    if count_lines(path) > TRIM_TRIGGER {
        trim(path)?;
    }
    Ok(())
}

/// Whether the log already holds a record written under `key`.
fn has_dedupe_key(path: &PathBuf, key: &str) -> bool {
    read_events(path)
        .iter()
        .any(|event| event.dedupe_key.as_deref() == Some(key))
}

/// Append a record only when its `dedupe_key` is not in the log yet.
///
/// Jean sees a merged pull request by polling, so the same merge is reported on
/// every tick. The key makes the first report win, and it survives a restart
/// because the check reads the log itself.
///
/// Returns `true` when a record was written.
/// Append a record and drop any older one written under the same `dedupe_key`.
///
/// For something that happens repeatedly but is only worth one row, where the
/// newest occurrence is the interesting one. A run finishes once per chat turn,
/// so a long session would otherwise push every commit, pull request and review
/// out of a feed that holds [`MAX_EVENTS`] records.
///
/// The opposite of [`record_once`], which keeps the first occurrence.
pub fn record_replacing(app: &AppHandle, kind: ActivityKind, new: NewActivity) {
    let Some(key) = new.dedupe_key.clone() else {
        log::warn!("[Activity] record_replacing called without a dedupe key; ignoring {kind:?}");
        return;
    };

    if let Ok(path) = activity_path(app) {
        if let Err(e) = drop_dedupe_key(&path, &key) {
            // The stale row stays and the new one is still appended, so the
            // feed is duplicated rather than wrong.
            log::warn!("[Activity] failed to drop {key}: {e}");
        }
    }

    record(app, kind, new);
}

/// The records not written under `key`.
fn without_dedupe_key(events: Vec<ActivityEvent>, key: &str) -> Vec<ActivityEvent> {
    events
        .into_iter()
        .filter(|event| event.dedupe_key.as_deref() != Some(key))
        .collect()
}

/// Rewrite the log without the records written under `key`.
fn drop_dedupe_key(path: &PathBuf, key: &str) -> Result<(), String> {
    let events = read_events(path);
    let before = events.len();
    let keep = without_dedupe_key(events, key);
    if keep.len() == before {
        return Ok(());
    }

    let body = keep
        .iter()
        .filter_map(|event| serde_json::to_string(event).ok())
        .collect::<Vec<_>>()
        .join("\n");

    let temp = path.with_extension(format!("jsonl.tmp{}", std::process::id()));
    let contents = if body.is_empty() {
        String::new()
    } else {
        format!("{body}\n")
    };
    std::fs::write(&temp, contents).map_err(|e| format!("Failed to write activity log: {e}"))?;
    std::fs::rename(&temp, path).map_err(|e| format!("Failed to replace activity log: {e}"))
}

pub fn record_once(app: &AppHandle, kind: ActivityKind, new: NewActivity) -> bool {
    let Some(key) = new.dedupe_key.clone() else {
        log::warn!("[Activity] record_once called without a dedupe key; ignoring {kind:?}");
        return false;
    };

    let Ok(path) = activity_path(app) else {
        return false;
    };
    if has_dedupe_key(&path, &key) {
        return false;
    }

    record(app, kind, new);
    true
}

/// The newest records first, capped at `limit` (default 50, maximum
/// [`MAX_EVENTS`]).
pub async fn list_recent_activity(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ActivityEvent>, String> {
    let path = activity_path(&app)?;
    let mut events = newest_first(read_events(&path));
    events.truncate(limit.unwrap_or(50).min(MAX_EVENTS));
    Ok(events)
}

/// Order append-ordered records newest first.
///
/// `at` has second resolution, so several records routinely share one value -
/// a commit and the pull request opened from it, for example. Reversing before
/// the stable sort puts the newest of a tied group on top and keeps it there;
/// sorting the append order directly would hand back a tied group oldest-first.
fn newest_first(mut events: Vec<ActivityEvent>) -> Vec<ActivityEvent> {
    events.reverse();
    events.sort_by_key(|event| std::cmp::Reverse(event.at));
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn event(id: &str, at: u64) -> ActivityEvent {
        ActivityEvent {
            id: id.to_string(),
            kind: ActivityKind::CommitCreated,
            at,
            project_id: None,
            project_name: None,
            worktree_id: None,
            worktree_name: None,
            worktree_path: None,
            session_id: None,
            session_name: None,
            title: None,
            url: None,
            dedupe_key: None,
        }
    }

    fn keyed(id: &str, at: u64, key: &str) -> ActivityEvent {
        ActivityEvent {
            dedupe_key: Some(key.to_string()),
            ..event(id, at)
        }
    }

    #[test]
    fn records_sharing_one_second_come_back_newest_first() {
        // Append order, so "b" was written after "a".
        let ordered = newest_first(vec![event("a", 10), event("b", 10)]);

        let ids: Vec<_> = ordered.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["b", "a"]);
    }

    #[test]
    fn newest_first_still_orders_by_timestamp() {
        let ordered = newest_first(vec![event("old", 1), event("new", 5)]);

        let ids: Vec<_> = ordered.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn a_replaced_key_leaves_only_the_other_records() {
        let events = vec![
            keyed("first-turn", 1, "run-outcome:s1"),
            event("a-commit", 2),
            keyed("other-session", 3, "run-outcome:s2"),
        ];

        let keep = without_dedupe_key(events, "run-outcome:s1");

        let ids: Vec<_> = keep.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["a-commit", "other-session"]);
    }

    #[test]
    fn dropping_an_absent_key_keeps_every_record() {
        let events = vec![event("a", 1), keyed("b", 2, "run-outcome:s1")];

        let keep = without_dedupe_key(events, "run-outcome:missing");

        assert_eq!(keep.len(), 2);
    }

    fn body(events: &[ActivityEvent]) -> String {
        events
            .iter()
            .map(|event| serde_json::to_string(event).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn parses_every_valid_line_in_order() {
        let events = vec![event("a", 1), event("b", 2)];
        let parsed = parse_events(Cursor::new(body(&events)));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "a");
        assert_eq!(parsed[1].id, "b");
    }

    #[test]
    fn skips_torn_and_blank_lines() {
        let good = serde_json::to_string(&event("a", 1)).unwrap();
        let text = format!("{good}\n\n{{\"id\":\"b\",\"kind\":\n{good}");
        let parsed = parse_events(Cursor::new(text));
        assert_eq!(
            parsed.len(),
            2,
            "a half-written line must not hide the rest"
        );
    }

    #[test]
    fn skips_records_with_an_unknown_kind() {
        let text = r#"{"id":"a","kind":"time_travelled","at":1}"#;
        assert!(parse_events(Cursor::new(text)).is_empty());
    }

    #[test]
    fn trim_keeps_the_newest_records() {
        let (dir, path) = temp_log();

        let events: Vec<_> = (0..TRIM_TRIGGER + 10)
            .map(|i| event(&format!("e{i}"), i as u64))
            .collect();
        std::fs::write(&path, format!("{}\n", body(&events))).unwrap();

        trim(&path).unwrap();

        let kept = read_events(&path);
        assert_eq!(kept.len(), MAX_EVENTS);
        assert_eq!(kept.last().unwrap().id, format!("e{}", TRIM_TRIGGER + 9));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn temp_log() -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("jean-activity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("activity.jsonl");
        (dir, path)
    }

    #[test]
    fn appended_records_read_back_in_order() {
        let (dir, path) = temp_log();

        append_event(&path, &event("a", 1)).unwrap();
        append_event(&path, &event("b", 2)).unwrap();

        let read = read_events(&path);
        assert_eq!(
            read.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_trims_once_the_file_grows_past_the_trigger() {
        let (dir, path) = temp_log();

        for i in 0..=TRIM_TRIGGER {
            append_event(&path, &event(&format!("e{i}"), i as u64)).unwrap();
        }

        let read = read_events(&path);
        assert_eq!(read.len(), MAX_EVENTS);
        assert_eq!(read.last().unwrap().id, format!("e{TRIM_TRIGGER}"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_dedupe_key_is_found_after_it_is_written() {
        let (dir, path) = temp_log();

        assert!(!has_dedupe_key(&path, "pr:x:merged"));

        let mut merged = event("m", 1);
        merged.dedupe_key = Some("pr:x:merged".to_string());
        append_event(&path, &merged).unwrap();

        assert!(has_dedupe_key(&path, "pr:x:merged"));
        assert!(
            !has_dedupe_key(&path, "pr:x:closed"),
            "a different state of the same pull request is still loggable"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn each_flavor_uses_its_own_file() {
        assert_eq!(activity_file_name(Some("JeanZ")), ACTIVITY_FILE_JEANZ);
        assert_eq!(activity_file_name(Some("Jean")), ACTIVITY_FILE);
        assert_eq!(activity_file_name(None), ACTIVITY_FILE);
        assert_ne!(ACTIVITY_FILE, ACTIVITY_FILE_JEANZ);
    }

    #[test]
    fn first_line_takes_the_commit_subject() {
        assert_eq!(first_line("subject\n\nbody text"), "subject");
        assert_eq!(first_line("\n\n  subject  \nbody"), "subject");
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn first_line_caps_a_very_long_subject() {
        let long = "x".repeat(200);
        let capped = first_line(&long);
        assert_eq!(
            capped.chars().count(),
            121,
            "120 characters plus an ellipsis"
        );
        assert!(capped.ends_with('\u{2026}'));
    }

    #[test]
    fn kind_serializes_as_snake_case_for_typescript() {
        let json = serde_json::to_string(&ActivityKind::SessionCompleted).unwrap();
        assert_eq!(json, "\"session_completed\"");
    }
}
