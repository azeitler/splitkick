//! One flat, filtered list of every session in every project.
//!
//! This exists for the Jean MCP tool of the same name. An agent asked "which
//! sessions can I archive?" would otherwise have to walk
//! `list_projects → list_worktrees → list_sessions → read_session_messages`,
//! which is dozens of calls and hundreds of raw messages before it can decide
//! anything.
//!
//! Not to be confused with `chat::list_all_sessions` (`chat/commands.rs`),
//! which groups whole `Session` structs by worktree for the Load Context modal.
//! This module returns small, filtered, camelCase records built for a model to
//! read.
//!
//! Cost discipline: filter and paginate first, enrich afterwards. The recap and
//! git lookups run only over the page that is actually returned, so their cost
//! is bounded by `limit` and never by how many sessions exist. Nothing in this
//! module touches the network — no `git fetch`, no `gh`.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tauri::AppHandle;

use crate::chat::commands::run_status_label;
use crate::chat::recap::latest_recap_for_session;
use crate::chat::storage::load_sessions;
use crate::chat::types::Session;
use crate::projects::storage::load_projects_data;
use crate::projects::types::Worktree;

/// Statuses `run_status_label` can return, for validating the filter.
pub const OVERVIEW_STATUSES: [&str; 5] = ["idle", "running", "resumable", "cancelled", "error"];

const SECONDS_PER_DAY: u64 = 86_400;

/// Ordering of the result before it is paginated.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub enum OverviewSort {
    /// Newest activity first. The default, and what a "what is going on?"
    /// question wants.
    #[default]
    Recent,
    /// Oldest activity first. What a "what can I archive?" question wants: the
    /// first page then holds the best candidates instead of the worst.
    Stale,
}

impl OverviewSort {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "recent" => Some(Self::Recent),
            "stale" => Some(Self::Stale),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionOverviewOptions {
    pub project_id: Option<String>,
    /// Include archived sessions *and* sessions that live in an archived
    /// worktree. The two are different: archiving a worktree does not set
    /// `archived_at` on its sessions.
    pub include_archived: bool,
    pub idle_for_days: Option<u64>,
    /// Keep only these effective statuses. Empty means every status.
    pub statuses: Vec<String>,
    pub sort: OverviewSort,
    pub limit: usize,
    pub offset: usize,
    pub include_recap: bool,
    pub include_open_work: bool,
    pub verbose: bool,
}

impl Default for SessionOverviewOptions {
    fn default() -> Self {
        Self {
            project_id: None,
            include_archived: false,
            idle_for_days: None,
            statuses: vec![],
            sort: OverviewSort::default(),
            limit: DEFAULT_OVERVIEW_LIMIT,
            offset: 0,
            include_recap: false,
            include_open_work: false,
            verbose: false,
        }
    }
}

pub const DEFAULT_OVERVIEW_LIMIT: usize = 100;

/// Page size ceiling while `include_open_work` is on. Each distinct worktree in
/// the page costs one `git status`, and a hundred of those can outlast an MCP
/// client's timeout.
pub const OPEN_WORK_LIMIT: usize = 50;

/// Uncommitted and unpushed work in a worktree. Counts only — the agent calls
/// `get_worktree_changes` for the few worktrees that need a closer look.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWork {
    pub uncommitted_files: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unpushed_commits: Option<u32>,
}

/// The pull request linked to the session's worktree, from cache. Never fetched.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPr {
    pub number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checks: Option<String>,
}

/// Settings a caller only wants when it asked for `verbose`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverviewVerbose {
    pub backend: String,
    pub order: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub worktree_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_execution_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
}

/// One session, small enough that a hundred of them fit in a model's context.
///
/// Everything after `status` is omitted when it is absent, false or empty, so a
/// plain idle session costs about one short line.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverviewRecord {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub project_name: String,
    pub worktree_id: String,
    pub worktree_name: String,
    /// Effective status: idle, running, resumable, cancelled or error.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<u64>,
    /// Whole days since the last activity. Saves the caller from doing date
    /// arithmetic on unix timestamps.
    pub idle_days: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<u32>,
    /// The status the user pinned by hand: idle, review, paused, completed or
    /// cancelled. The strongest "this is finished" signal there is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_status: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub waiting_for_input: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub archived: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub worktree_archived: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub pinned: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub starred: bool,
    /// The session's own label. A session carries at most one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub worktree_labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linear_issue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_pr: Option<LinkedPr>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_recap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_work: Option<OpenWork>,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub verbose: Option<SessionOverviewVerbose>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverviewResponse {
    pub sessions: Vec<SessionOverviewRecord>,
    /// How many sessions matched the filters, before pagination.
    pub total: usize,
    /// True when `total` is larger than what this page returned.
    pub truncated: bool,
    /// Pass this back as `offset` to get the next page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// When the session was last active.
///
/// `last_message_at` is `None` for a session that never ran, and `updated_at`
/// already folds in terminal activity, so a terminal-only session is not
/// reported as idle since 1970.
pub fn last_activity_at(session: &Session) -> u64 {
    session
        .last_message_at
        .unwrap_or(session.updated_at)
        .max(session.created_at)
}

fn idle_days(last_activity: u64, now: u64) -> u64 {
    now.saturating_sub(last_activity) / SECONDS_PER_DAY
}

/// Build the record for one session. Pure: every input is already loaded.
#[allow(clippy::too_many_arguments)]
pub fn build_record(
    session: &Session,
    project_id: &str,
    project_name: &str,
    worktree: &Worktree,
    actively_managed: bool,
    pinned: bool,
    starred: bool,
    verbose: bool,
    now: u64,
) -> SessionOverviewRecord {
    let last_activity = last_activity_at(session);

    SessionOverviewRecord {
        id: session.id.clone(),
        name: session.name.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        worktree_id: worktree.id.clone(),
        worktree_name: worktree.name.clone(),
        status: run_status_label(actively_managed, session.last_run_status.as_ref()).to_string(),
        last_message_at: session.last_message_at,
        idle_days: idle_days(last_activity, now),
        message_count: session.message_count,
        manual_status: session.status_override.clone(),
        waiting_for_input: session.waiting_for_input,
        archived: session.archived_at.is_some(),
        worktree_archived: worktree.archived_at.is_some(),
        pinned,
        starred,
        label: session.label.as_ref().map(|label| label.name.clone()),
        worktree_labels: worktree
            .labels
            .iter()
            .map(|label| label.name.clone())
            .collect(),
        issue_number: worktree.issue_number,
        linear_issue: worktree.linear_issue_identifier.clone(),
        linked_pr: worktree.pr_number.map(|number| LinkedPr {
            number,
            url: worktree.pr_url.clone(),
            status: worktree.cached_pr_status.clone(),
            checks: worktree.cached_check_status.clone(),
        }),
        last_recap: None,
        open_work: None,
        verbose: verbose.then(|| SessionOverviewVerbose {
            backend: format!("{:?}", session.backend).to_lowercase(),
            order: session.order,
            created_at: session.created_at,
            updated_at: session.updated_at,
            worktree_path: worktree.path.clone(),
            selected_model: session.selected_model.clone(),
            selected_provider: session.selected_provider.clone(),
            selected_execution_mode: session.selected_execution_mode.clone(),
            archived_at: session.archived_at,
        }),
    }
}

/// Does this record pass the caller's filters? Pure.
pub fn matches_filters(
    record: &SessionOverviewRecord,
    idle_for_days: Option<u64>,
    statuses: &[String],
) -> bool {
    if idle_for_days.is_some_and(|days| record.idle_days < days) {
        return false;
    }
    if !statuses.is_empty() && !statuses.iter().any(|wanted| wanted == &record.status) {
        return false;
    }
    true
}

/// Cut one page out of the filtered list. Pure.
pub fn paginate(
    mut records: Vec<SessionOverviewRecord>,
    offset: usize,
    limit: usize,
) -> (Vec<SessionOverviewRecord>, usize, bool, Option<usize>) {
    let total = records.len();
    if offset >= total {
        return (vec![], total, offset < total, None);
    }
    let page: Vec<SessionOverviewRecord> = records.drain(offset..).take(limit).collect();
    let end = offset + page.len();
    let truncated = end < total;
    let next_offset = truncated.then_some(end);
    (page, total, truncated, next_offset)
}

/// Sort records in place for the requested order.
///
/// The id breaks ties, so two sessions with the same activity timestamp keep a
/// stable order between pages. Without it, paging could drop or repeat a row.
fn sort_records(records: &mut [(u64, SessionOverviewRecord)], sort: OverviewSort) {
    records.sort_by(|a, b| match sort {
        OverviewSort::Recent => b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)),
        OverviewSort::Stale => a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)),
    });
}

/// Uncommitted and unpushed counts for one worktree.
///
/// One local `git status --porcelain` plus a cached number. Deliberately not
/// `git_status::get_branch_status`, which fetches from the remote, and
/// deliberately not `count_commits_between`, which reports zero unpushed
/// commits when `origin/<branch>` does not exist yet — wrong in the one
/// direction that would make an agent archive unpushed work.
fn open_work_for(worktree: &Worktree) -> Option<OpenWork> {
    let uncommitted_files = crate::projects::git::get_uncommitted_count(&worktree.path).ok()?;
    Some(OpenWork {
        uncommitted_files,
        unpushed_commits: worktree.cached_unpushed_count,
    })
}

/// List every session across every project, filtered on the server.
pub async fn session_overview(
    app: &AppHandle,
    options: SessionOverviewOptions,
) -> Result<SessionOverviewResponse, String> {
    let limit = if options.include_open_work {
        options.limit.min(OPEN_WORK_LIMIT)
    } else {
        options.limit
    };
    let now = now_secs();
    let projects_data = load_projects_data(app)?;

    // A corrupt UI state file must cost the pin and star flags, not the whole
    // listing.
    let ui_state = crate::load_ui_state(app.clone()).await.unwrap_or_default();
    let pinned: HashSet<&str> = ui_state
        .project_canvas_settings
        .values()
        .flat_map(|settings| &settings.pinned_sessions)
        .map(|entry| entry.session_id.as_str())
        .collect();
    let starred: HashSet<&str> = ui_state
        .starred_sessions
        .iter()
        .map(|entry| entry.session_id.as_str())
        .collect();

    let mut records: Vec<(u64, SessionOverviewRecord)> = Vec::new();

    for project in &projects_data.projects {
        if options
            .project_id
            .as_ref()
            .is_some_and(|wanted| wanted != &project.id)
        {
            continue;
        }

        for worktree in projects_data.worktrees_for_project(&project.id) {
            if !options.include_archived && worktree.archived_at.is_some() {
                continue;
            }

            let sessions = match load_sessions(app, &worktree.path, &worktree.id) {
                Ok(sessions) => sessions,
                Err(e) => {
                    // A worktree with no sessions yet is normal, not fatal.
                    log::warn!("[SessionOverview] worktree={} sessions: {e}", worktree.id);
                    continue;
                }
            };

            for session in &sessions.sessions {
                if !options.include_archived && session.archived_at.is_some() {
                    continue;
                }

                let record = build_record(
                    session,
                    &project.id,
                    &project.name,
                    worktree,
                    crate::chat::registry::is_session_actively_managed(&session.id),
                    pinned.contains(session.id.as_str()),
                    starred.contains(session.id.as_str()),
                    options.verbose,
                    now,
                );

                if !matches_filters(&record, options.idle_for_days, &options.statuses) {
                    continue;
                }
                records.push((last_activity_at(session), record));
            }
        }
    }

    sort_records(&mut records, options.sort);
    let sorted: Vec<SessionOverviewRecord> =
        records.into_iter().map(|(_, record)| record).collect();
    let (mut page, total, truncated, next_offset) = paginate(sorted, options.offset, limit);

    // Enrichment runs only over the page. This is what keeps the expensive
    // work proportional to `limit` instead of to the number of sessions.
    if options.include_open_work {
        let mut cache: HashMap<String, Option<OpenWork>> = HashMap::new();
        for record in &mut page {
            let open_work = cache
                .entry(record.worktree_id.clone())
                .or_insert_with(|| {
                    projects_data
                        .find_worktree(&record.worktree_id)
                        .and_then(open_work_for)
                })
                .clone();
            record.open_work = open_work;
        }
    }

    if options.include_recap {
        for record in &mut page {
            record.last_recap = latest_recap_for_session(app, &record.id);
        }
    }

    log::debug!(
        "[SessionOverview] returned={} total={total} truncated={truncated}",
        page.len()
    );

    Ok(SessionOverviewResponse {
        sessions: page,
        total,
        truncated,
        next_offset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::{Backend, LabelData, RunStatus};

    /// Build a worktree from its required fields only. Every other field is an
    /// `Option` or has a serde default, exactly as in a stored `projects.json`,
    /// so this stays readable while `Worktree` keeps growing.
    fn worktree(id: &str) -> Worktree {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "project_id": "p1",
            "name": format!("wt-{id}"),
            "path": format!("/tmp/{id}"),
            "branch": "feature",
            "created_at": 0,
        }))
        .unwrap()
    }

    fn session(id: &str, last_message_at: u64) -> Session {
        let mut session = Session::new(format!("session {id}"), 0, Backend::Claude);
        session.id = id.to_string();
        session.created_at = 0;
        session.updated_at = last_message_at;
        session.last_message_at = Some(last_message_at);
        session
    }

    fn record(id: &str, last_message_at: u64, now: u64) -> SessionOverviewRecord {
        build_record(
            &session(id, last_message_at),
            "p1",
            "jean",
            &worktree("w1"),
            false,
            false,
            false,
            false,
            now,
        )
    }

    #[test]
    fn a_plain_record_serialises_without_null_or_false_keys() {
        let json = serde_json::to_string(&record("s1", 100, 100)).unwrap();

        assert!(!json.contains("null"), "{json}");
        assert!(!json.contains("false"), "{json}");
        assert!(!json.contains("lastRecap"), "{json}");
        assert!(!json.contains("openWork"), "{json}");
        // camelCase, matching every other Jean MCP tool.
        assert!(json.contains("\"projectId\":\"p1\""), "{json}");
        assert!(json.contains("\"idleDays\":0"), "{json}");
    }

    #[test]
    fn idle_days_counts_whole_days_since_the_last_activity() {
        let now = 10 * SECONDS_PER_DAY;
        assert_eq!(record("s1", 7 * SECONDS_PER_DAY, now).idle_days, 3);
        // Half a day past the boundary still reads as three days.
        assert_eq!(
            record("s1", 7 * SECONDS_PER_DAY - SECONDS_PER_DAY / 2, now).idle_days,
            3
        );
    }

    #[test]
    fn a_session_that_never_ran_is_not_idle_since_1970() {
        let now = 10 * SECONDS_PER_DAY;
        let mut never_ran = session("s1", 0);
        never_ran.last_message_at = None;
        never_ran.updated_at = 0;
        never_ran.created_at = 9 * SECONDS_PER_DAY;

        let record = build_record(
            &never_ran,
            "p1",
            "jean",
            &worktree("w1"),
            false,
            false,
            false,
            false,
            now,
        );

        assert_eq!(record.idle_days, 1);
    }

    #[test]
    fn the_record_carries_the_archive_signals() {
        let mut finished = session("s1", 100);
        finished.status_override = Some("completed".to_string());
        finished.label = Some(LabelData {
            name: "Needs testing".to_string(),
            color: "#eab308".to_string(),
            pinned: false,
        });
        finished.last_run_status = Some(RunStatus::Completed);

        let mut worktree = worktree("w1");
        worktree.pr_number = Some(30);
        worktree.pr_url = Some("https://example.test/pr/30".to_string());
        worktree.cached_pr_status = Some("merged".to_string());
        worktree.issue_number = Some(24);
        worktree.labels = vec![LabelData {
            name: "shipped".to_string(),
            color: "#22c55e".to_string(),
            pinned: false,
        }];

        let record = build_record(
            &finished, "p1", "jean", &worktree, false, true, true, false, 100,
        );

        assert_eq!(record.status, "idle");
        assert_eq!(record.manual_status.as_deref(), Some("completed"));
        assert_eq!(record.label.as_deref(), Some("Needs testing"));
        assert_eq!(record.worktree_labels, vec!["shipped".to_string()]);
        assert_eq!(record.issue_number, Some(24));
        assert_eq!(record.linked_pr.as_ref().unwrap().number, 30);
        assert_eq!(
            record.linked_pr.as_ref().unwrap().status.as_deref(),
            Some("merged")
        );
        assert!(record.pinned);
        assert!(record.starred);
    }

    #[test]
    fn a_live_run_wins_over_the_manual_status() {
        let mut running = session("s1", 100);
        running.status_override = Some("completed".to_string());

        let record = build_record(
            &running,
            "p1",
            "jean",
            &worktree("w1"),
            true,
            false,
            false,
            false,
            100,
        );

        assert_eq!(record.status, "running");
        assert_eq!(record.manual_status.as_deref(), Some("completed"));
    }

    #[test]
    fn verbose_adds_the_settings_and_flattens_them() {
        let record = build_record(
            &session("s1", 100),
            "p1",
            "jean",
            &worktree("w1"),
            false,
            false,
            false,
            true,
            100,
        );
        let json = serde_json::to_value(&record).unwrap();

        assert_eq!(json["backend"], "claude");
        assert_eq!(json["worktreePath"], "/tmp/w1");
        assert!(json.get("verbose").is_none(), "flattened, not nested");
    }

    #[test]
    fn idle_for_days_includes_a_session_exactly_at_the_boundary() {
        let now = 10 * SECONDS_PER_DAY;
        let record = record("s1", 3 * SECONDS_PER_DAY, now);

        assert_eq!(record.idle_days, 7);
        assert!(matches_filters(&record, Some(7), &[]));
        assert!(matches_filters(&record, Some(6), &[]));
        assert!(!matches_filters(&record, Some(8), &[]));
    }

    #[test]
    fn the_status_filter_is_a_union() {
        let record = record("s1", 100, 100);

        assert!(matches_filters(&record, None, &[]));
        assert!(matches_filters(
            &record,
            None,
            &["error".to_string(), "idle".to_string()]
        ));
        assert!(!matches_filters(&record, None, &["running".to_string()]));
    }

    #[test]
    fn pagination_reports_the_next_offset_only_while_rows_remain() {
        let records: Vec<SessionOverviewRecord> =
            (0..5).map(|i| record(&format!("s{i}"), 100, 100)).collect();

        let (page, total, truncated, next) = paginate(records.clone(), 0, 2);
        assert_eq!(page.len(), 2);
        assert_eq!(total, 5);
        assert!(truncated);
        assert_eq!(next, Some(2));

        let (page, _, truncated, next) = paginate(records.clone(), 4, 2);
        assert_eq!(page.len(), 1);
        assert!(!truncated);
        assert_eq!(next, None);

        let (page, total, truncated, next) = paginate(records.clone(), 0, 5);
        assert_eq!(page.len(), 5);
        assert_eq!(total, 5);
        assert!(!truncated);
        assert_eq!(next, None);

        let (page, total, _, next) = paginate(records, 9, 5);
        assert!(page.is_empty());
        assert_eq!(total, 5);
        assert_eq!(next, None);
    }

    #[test]
    fn paging_is_stable_when_activity_timestamps_tie() {
        let mut records: Vec<(u64, SessionOverviewRecord)> = ["s3", "s1", "s2"]
            .iter()
            .map(|id| (100, record(id, 100, 100)))
            .collect();

        sort_records(&mut records, OverviewSort::Recent);
        let ids: Vec<&str> = records.iter().map(|(_, r)| r.id.as_str()).collect();

        assert_eq!(ids, vec!["s1", "s2", "s3"]);
    }

    #[test]
    fn stale_sort_puts_the_best_archive_candidates_first() {
        let now = 10 * SECONDS_PER_DAY;
        let mut records: Vec<(u64, SessionOverviewRecord)> = vec![
            (
                9 * SECONDS_PER_DAY,
                record("fresh", 9 * SECONDS_PER_DAY, now),
            ),
            (SECONDS_PER_DAY, record("old", SECONDS_PER_DAY, now)),
        ];

        sort_records(&mut records, OverviewSort::Stale);
        assert_eq!(records[0].1.id, "old");

        sort_records(&mut records, OverviewSort::Recent);
        assert_eq!(records[0].1.id, "fresh");
    }

    #[test]
    fn sort_names_parse_and_reject() {
        assert_eq!(OverviewSort::parse("recent"), Some(OverviewSort::Recent));
        assert_eq!(OverviewSort::parse("stale"), Some(OverviewSort::Stale));
        assert_eq!(OverviewSort::parse("oldest"), None);
    }
    // ---- end to end, against a real temp data directory ----

    struct Fixture {
        _temp: tempfile::TempDir,
        app: AppHandle,
    }

    /// A data directory holding two projects, one worktree each, and the
    /// sessions named in `sessions` (worktree id -> session ids).
    fn fixture(prefix: &str, sessions: &[(&str, &[&str])]) -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().into(), temp.path().into()).unwrap();

        let mut projects = vec![];
        let mut worktrees = vec![];
        for (index, project) in ["a", "b"].iter().enumerate() {
            let project_id = format!("{prefix}-p{project}");
            projects.push(serde_json::json!({
                "id": project_id,
                "name": format!("project-{project}"),
                "path": temp.path().join(format!("repo-{project}")),
                "default_branch": "main",
                "added_at": 0,
                "order": index,
            }));
        }
        for (worktree_id, _) in sessions {
            // The loader drops worktrees whose path is gone, so create it.
            let path = temp.path().join(worktree_id);
            std::fs::create_dir_all(&path).unwrap();
            let project = if worktree_id.ends_with('b') { "b" } else { "a" };
            worktrees.push(serde_json::json!({
                "id": worktree_id,
                "project_id": format!("{prefix}-p{project}"),
                "name": format!("wt-{worktree_id}"),
                "path": path,
                "branch": "feature",
                "created_at": 0,
            }));
        }

        let data: crate::projects::types::ProjectsData =
            serde_json::from_value(serde_json::json!({
                "projects": projects,
                "worktrees": worktrees,
            }))
            .unwrap();
        crate::projects::storage::save_projects_data(&app, &data).unwrap();

        for (worktree_id, session_ids) in sessions {
            crate::chat::storage::with_sessions_mut(&app, "", worktree_id, |stored| {
                // A fresh index comes with one default session. Drop it so the
                // ids in these tests are the ones the test named.
                stored.sessions.clear();
                for (order, session_id) in session_ids.iter().enumerate() {
                    let mut session = Session::new(
                        format!("session {session_id}"),
                        order as u32,
                        Backend::Claude,
                    );
                    session.id = (*session_id).to_string();
                    stored.sessions.push(session);
                }
                Ok(())
            })
            .unwrap();
        }

        Fixture { _temp: temp, app }
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn ids(response: &SessionOverviewResponse) -> Vec<&str> {
        response
            .sessions
            .iter()
            .map(|record| record.id.as_str())
            .collect()
    }

    #[test]
    fn lists_every_session_of_every_project_in_one_call() {
        let fixture = fixture(
            "all",
            &[("all-wa", &["all-s1", "all-s2"]), ("all-wb", &["all-s3"])],
        );

        let response = block_on(session_overview(
            &fixture.app,
            SessionOverviewOptions::default(),
        ))
        .unwrap();

        assert_eq!(response.total, 3);
        assert!(!response.truncated);
        assert_eq!(response.next_offset, None);
        let mut found = ids(&response);
        found.sort_unstable();
        assert_eq!(found, vec!["all-s1", "all-s2", "all-s3"]);
        assert_eq!(response.sessions[0].project_name, "project-a");
    }

    #[test]
    fn the_project_filter_keeps_only_that_project() {
        let fixture = fixture(
            "filter",
            &[("filter-wa", &["filter-s1"]), ("filter-wb", &["filter-s2"])],
        );

        let response = block_on(session_overview(
            &fixture.app,
            SessionOverviewOptions {
                project_id: Some("filter-pb".to_string()),
                ..Default::default()
            },
        ))
        .unwrap();

        assert_eq!(ids(&response), vec!["filter-s2"]);
    }

    #[test]
    fn archived_sessions_and_archived_worktrees_are_both_hidden_by_default() {
        let fixture = fixture(
            "arch",
            &[
                ("arch-wa", &["arch-live", "arch-gone"]),
                ("arch-wb", &["arch-inwt"]),
            ],
        );

        // Archive one session, and the whole second worktree.
        crate::chat::storage::with_sessions_mut(&fixture.app, "", "arch-wa", |stored| {
            let session = stored
                .sessions
                .iter_mut()
                .find(|s| s.id == "arch-gone")
                .unwrap();
            session.archived_at = Some(1);
            Ok(())
        })
        .unwrap();
        let mut data = crate::projects::storage::load_projects_data(&fixture.app).unwrap();
        data.find_worktree_mut("arch-wb").unwrap().archived_at = Some(1);
        crate::projects::storage::save_projects_data(&fixture.app, &data).unwrap();

        let response = block_on(session_overview(
            &fixture.app,
            SessionOverviewOptions::default(),
        ))
        .unwrap();
        assert_eq!(ids(&response), vec!["arch-live"]);

        let response = block_on(session_overview(
            &fixture.app,
            SessionOverviewOptions {
                include_archived: true,
                ..Default::default()
            },
        ))
        .unwrap();
        let mut found = ids(&response);
        found.sort_unstable();
        assert_eq!(found, vec!["arch-gone", "arch-inwt", "arch-live"]);

        let in_worktree = response
            .sessions
            .iter()
            .find(|record| record.id == "arch-inwt")
            .unwrap();
        // The session is not archived; its worktree is. The distinction decides
        // whether it is worth archiving at all.
        assert!(!in_worktree.archived);
        assert!(in_worktree.worktree_archived);
    }

    #[test]
    fn paging_walks_every_session_exactly_once() {
        let ids_in: Vec<String> = (0..5).map(|i| format!("page-s{i}")).collect();
        let refs: Vec<&str> = ids_in.iter().map(String::as_str).collect();
        let fixture = fixture("page", &[("page-wa", &refs)]);

        let mut seen = Vec::new();
        let mut offset = Some(0);
        while let Some(next) = offset {
            let response = block_on(session_overview(
                &fixture.app,
                SessionOverviewOptions {
                    limit: 2,
                    offset: next,
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(response.total, 5);
            seen.extend(ids(&response).into_iter().map(str::to_string));
            offset = response.next_offset;
        }

        seen.sort();
        assert_eq!(seen, ids_in);
    }

    #[test]
    fn pins_and_stars_come_from_the_ui_state_file() {
        let fixture = fixture("mark", &[("mark-wa", &["mark-s1", "mark-s2"])]);

        let ui_state = crate::UIState {
            starred_sessions: vec![crate::StarredSessionEntry {
                project_id: "mark-pa".to_string(),
                worktree_id: "mark-wa".to_string(),
                session_id: "mark-s1".to_string(),
            }],
            project_canvas_settings: std::collections::HashMap::from([(
                "mark-pa".to_string(),
                crate::ProjectCanvasSettings {
                    pinned_sessions: vec![crate::PinnedSessionEntry {
                        session_id: "mark-s2".to_string(),
                        worktree_id: "mark-wa".to_string(),
                    }],
                    ..Default::default()
                },
            )]),
            ..Default::default()
        };
        block_on(crate::save_ui_state(fixture.app.clone(), ui_state)).unwrap();

        let response = block_on(session_overview(
            &fixture.app,
            SessionOverviewOptions::default(),
        ))
        .unwrap();

        let starred = response
            .sessions
            .iter()
            .find(|record| record.id == "mark-s1")
            .unwrap();
        let pinned = response
            .sessions
            .iter()
            .find(|record| record.id == "mark-s2")
            .unwrap();

        assert!(starred.starred && !starred.pinned);
        assert!(pinned.pinned && !pinned.starred);
    }
}
