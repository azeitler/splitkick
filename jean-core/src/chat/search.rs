//! Full-text search across the messages of every session.
//!
//! Session metadata never carries message content — `SessionMetadata::to_session`
//! sets `messages: vec![]` and the real text lives in per-run JSONL logs. So a
//! client cannot search message content from `list_all_sessions`; the scan has
//! to happen here, next to the files.
//!
//! The scan is deliberately two-phase. Parsing every run of every session is
//! expensive and backend-specific, so each session first goes through a cheap
//! gate: the user prompts stored in metadata (no I/O at all) and a raw
//! substring scan of the run logs (no JSON parsing). Only a session that clears
//! the gate is parsed through `load_session_messages`, which reuses the existing
//! per-backend history parsers instead of duplicating them. Most sessions never
//! reach that step.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::chat::run_log::{get_run_log_path, load_session_messages};
use crate::chat::storage::{load_metadata, load_sessions};
use crate::projects::storage::load_projects_data;

/// Default number of sessions returned when the caller does not pass a limit.
pub const DEFAULT_SEARCH_LIMIT: usize = 30;

/// Characters of context kept on each side of a match inside a snippet.
const SNIPPET_RADIUS: usize = 70;

/// Shortest query worth scanning the disk for. One or two characters match
/// almost every session, so the result is noise that costs a full scan.
pub const MIN_QUERY_LEN: usize = 3;

/// One session that contains the query, with enough context to render a row
/// and to navigate to it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSearchHit {
    pub session_id: String,
    pub session_name: String,
    pub project_id: String,
    pub project_name: String,
    pub worktree_id: String,
    pub worktree_name: String,
    pub worktree_path: String,
    /// Message text around the first match, with an ellipsis where it was cut.
    pub snippet: String,
    /// Id of the message the snippet came from, so the UI can scroll to it.
    pub message_id: Option<String>,
    /// How many messages in the session matched, not how many times.
    pub match_count: usize,
    pub updated_at: u64,
    /// The query matched the session name. A name hit is returned even when no
    /// message matched, so a session found by its title still shows up.
    #[serde(default, skip_serializing_if = "is_false")]
    pub name_match: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// What to search and how much of it.
///
/// Defaults reproduce the command palette's behaviour exactly: every project,
/// active sessions only, message text only.
#[derive(Debug, Clone, Default)]
pub struct SessionSearchOptions {
    /// Restrict to one project. Skips every other project before any session
    /// is read, so it is the cheapest filter there is.
    pub project_id: Option<String>,
    /// Include archived sessions. Note that a session inside an archived
    /// worktree is not itself archived, and is always included; see the
    /// comment in the candidate loop.
    pub include_archived: bool,
    /// Also match the session name. Off by default so the palette keeps
    /// returning message hits only.
    pub match_names: bool,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSearchResponse {
    pub hits: Vec<SessionSearchHit>,
    /// True when the limit cut the result short, so the UI can say so.
    pub truncated: bool,
}

/// Case-insensitive substring position, in bytes.
///
/// `haystack_lower` must already be lowercased; `needle_lower` too. Lowercasing
/// can change byte length for some scripts, so the returned index is only used
/// against the lowercased haystack.
fn find_ci(haystack_lower: &str, needle_lower: &str) -> Option<usize> {
    haystack_lower.find(needle_lower)
}

/// Build a readable snippet around the first match.
///
/// Cuts on character boundaries so multi-byte text never panics, collapses
/// whitespace so a snippet stays on one line, and marks each cut with an
/// ellipsis.
pub fn build_snippet(content: &str, query_lower: &str) -> Option<String> {
    let collapsed: String = {
        let mut out = String::with_capacity(content.len());
        let mut last_was_space = false;
        for ch in content.chars() {
            if ch.is_whitespace() {
                if !last_was_space {
                    out.push(' ');
                }
                last_was_space = true;
            } else {
                out.push(ch);
                last_was_space = false;
            }
        }
        out.trim().to_string()
    };

    let lower = collapsed.to_lowercase();
    let byte_index = find_ci(&lower, query_lower)?;

    // Work in chars, because the lowercased string and the original can differ
    // in byte length. Counting chars up to the match keeps the two aligned for
    // the scripts we care about here.
    let match_char = lower[..byte_index].chars().count();
    let query_chars = query_lower.chars().count();
    let chars: Vec<char> = collapsed.chars().collect();

    let start = match_char.saturating_sub(SNIPPET_RADIUS);
    let end = (match_char + query_chars + SNIPPET_RADIUS).min(chars.len());

    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.extend(&chars[start..end]);
    if end < chars.len() {
        snippet.push('…');
    }
    Some(snippet)
}

/// Cheap gate: does any raw run log for this session contain the query?
///
/// Reads the JSONL bytes and lowercases them, but never parses JSON. A hit here
/// can be a false positive (the query may sit inside a tool payload rather than
/// message text), which is fine — phase two decides. A miss is authoritative,
/// so the expensive parse is skipped.
fn run_logs_contain(
    app: &AppHandle,
    session_id: &str,
    run_ids: &[String],
    query_lower: &str,
) -> bool {
    for run_id in run_ids {
        let Ok(path) = get_run_log_path(app, session_id, run_id) else {
            continue;
        };
        if !path.exists() {
            continue;
        }
        // A corrupt or unreadable log must not abort the whole search.
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        if raw.to_lowercase().contains(query_lower) {
            return true;
        }
    }
    false
}

/// A hit carried only by the session name, with no matching message.
fn name_only_hit(
    session: &crate::chat::types::Session,
    project_id: String,
    project_name: String,
    worktree_id: String,
    worktree_name: String,
    worktree_path: String,
) -> SessionSearchHit {
    SessionSearchHit {
        session_id: session.id.clone(),
        session_name: session.name.clone(),
        project_id,
        project_name,
        worktree_id,
        worktree_name,
        worktree_path,
        snippet: String::new(),
        message_id: None,
        match_count: 0,
        updated_at: session.last_message_at.unwrap_or(session.updated_at),
        name_match: true,
    }
}

/// Search the message content of every session in every project.
///
/// Results are ordered by session recency, newest first, and capped at `limit`.
pub async fn search_session_messages(
    app: AppHandle,
    query: String,
    options: SessionSearchOptions,
) -> Result<SessionSearchResponse, String> {
    let query_lower = query.trim().to_lowercase();
    if query_lower.chars().count() < MIN_QUERY_LEN {
        return Ok(SessionSearchResponse {
            hits: vec![],
            truncated: false,
        });
    }
    let limit = options.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if limit == 0 {
        return Ok(SessionSearchResponse {
            hits: vec![],
            truncated: false,
        });
    }

    let projects_data = load_projects_data(&app)?;
    let mut candidates = Vec::new();

    for project in &projects_data.projects {
        if options
            .project_id
            .as_ref()
            .is_some_and(|wanted| wanted != &project.id)
        {
            continue;
        }
        for worktree in projects_data.worktrees_for_project(&project.id) {
            let sessions = match load_sessions(&app, &worktree.path, &worktree.id) {
                Ok(sessions) => sessions,
                Err(e) => {
                    // Some worktrees have no sessions yet; that is not fatal.
                    log::warn!(
                        "[SearchSessions] worktree={} failed to load sessions: {e}",
                        worktree.id
                    );
                    continue;
                }
            };

            for session in sessions.sessions {
                // Only the session's own archived flag is checked. A session in
                // an archived worktree still matches, which is what the command
                // palette has always done; `chat::overview` is stricter.
                if !options.include_archived && session.archived_at.is_some() {
                    continue;
                }
                candidates.push((
                    project.id.clone(),
                    project.name.clone(),
                    worktree.id.clone(),
                    worktree.name.clone(),
                    worktree.path.clone(),
                    session,
                ));
            }
        }
    }

    // Newest first, so the limit keeps the most relevant sessions.
    candidates.sort_by(|a, b| {
        let a_at = a.5.last_message_at.unwrap_or(a.5.updated_at);
        let b_at = b.5.last_message_at.unwrap_or(b.5.updated_at);
        b_at.cmp(&a_at)
    });

    let mut hits = Vec::new();
    let mut truncated = false;

    for (project_id, project_name, worktree_id, worktree_name, worktree_path, session) in candidates
    {
        if hits.len() >= limit {
            truncated = true;
            break;
        }

        let name_hit = options.match_names && session.name.to_lowercase().contains(&query_lower);

        let Ok(Some(metadata)) = load_metadata(&app, &session.id) else {
            if name_hit {
                hits.push(name_only_hit(
                    &session,
                    project_id,
                    project_name,
                    worktree_id,
                    worktree_name,
                    worktree_path,
                ));
            }
            continue;
        };

        // Phase one, part A: user prompts live in metadata, so this costs no I/O.
        let prompt_hit = metadata
            .runs
            .iter()
            .any(|run| run.user_message.to_lowercase().contains(&query_lower));

        // Phase one, part B: raw scan of the run logs, no JSON parsing.
        if !prompt_hit {
            let run_ids: Vec<String> = metadata.runs.iter().map(|r| r.run_id.clone()).collect();
            if !run_logs_contain(&app, &session.id, &run_ids, &query_lower) {
                if name_hit {
                    hits.push(name_only_hit(
                        &session,
                        project_id,
                        project_name,
                        worktree_id,
                        worktree_name,
                        worktree_path,
                    ));
                }
                continue;
            }
        }

        // Phase two: only now is it worth parsing the session properly. This
        // reuses the per-backend history parsers rather than duplicating them.
        let messages = match load_session_messages(&app, &session.id) {
            Ok(messages) => messages,
            Err(e) => {
                log::warn!(
                    "[SearchSessions] session={} failed to load messages: {e}",
                    session.id
                );
                if name_hit {
                    hits.push(name_only_hit(
                        &session,
                        project_id,
                        project_name,
                        worktree_id,
                        worktree_name,
                        worktree_path,
                    ));
                }
                continue;
            }
        };

        let matching: Vec<_> = messages
            .iter()
            .filter(|m| m.content.to_lowercase().contains(&query_lower))
            .collect();

        // The raw gate can match inside a tool payload that never renders as
        // message text. Those are dropped rather than shown as an empty row,
        // unless the name matched and the row stands on its own.
        let snippet = matching
            .first()
            .and_then(|first| build_snippet(&first.content, &query_lower));
        let (Some(first), Some(snippet)) = (matching.first(), snippet) else {
            if name_hit {
                hits.push(name_only_hit(
                    &session,
                    project_id,
                    project_name,
                    worktree_id,
                    worktree_name,
                    worktree_path,
                ));
            }
            continue;
        };

        hits.push(SessionSearchHit {
            session_id: session.id.clone(),
            session_name: session.name.clone(),
            project_id,
            project_name,
            worktree_id,
            worktree_name,
            worktree_path,
            snippet,
            message_id: Some(first.id.clone()),
            match_count: matching.len(),
            updated_at: session.last_message_at.unwrap_or(session.updated_at),
            name_match: name_hit,
        });
    }

    log::debug!(
        "[SearchSessions] query={query_lower:?} hits={} truncated={truncated}",
        hits.len()
    );

    Ok(SessionSearchResponse { hits, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_marks_both_cuts_and_keeps_the_match() {
        let content = format!("{} NEEDLE {}", "a".repeat(200), "b".repeat(200));
        let snippet = build_snippet(&content, "needle").unwrap();

        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
        assert!(snippet.contains("NEEDLE"));
    }

    #[test]
    fn snippet_does_not_mark_cuts_that_did_not_happen() {
        let snippet = build_snippet("short needle here", "needle").unwrap();

        assert_eq!(snippet, "short needle here");
    }

    #[test]
    fn snippet_collapses_newlines_so_a_row_stays_on_one_line() {
        let snippet = build_snippet("first line\n\n\tsecond needle line", "needle").unwrap();

        assert_eq!(snippet, "first line second needle line");
        assert!(!snippet.contains('\n'));
    }

    #[test]
    fn snippet_survives_multi_byte_text() {
        // Cutting on byte offsets here would panic on a char boundary.
        let content = format!(
            "{} needle {}",
            "日本語テキスト".repeat(30),
            "ünïcodé".repeat(30)
        );
        let snippet = build_snippet(&content, "needle").unwrap();

        assert!(snippet.contains("needle"));
    }

    #[test]
    fn snippet_is_case_insensitive() {
        let snippet = build_snippet("The Parser Rewrite", "parser").unwrap();

        assert_eq!(snippet, "The Parser Rewrite");
    }

    #[test]
    fn snippet_is_none_when_the_content_does_not_match() {
        assert_eq!(build_snippet("nothing here", "needle"), None);
    }
    /// A data directory with one project, one worktree, and one session named
    /// "redirect notes" that has no messages at all.
    fn fixture_with_a_named_session() -> (tempfile::TempDir, AppHandle) {
        let temp = tempfile::tempdir().unwrap();
        let app = AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let worktree_path = temp.path().join("search-wt");
        std::fs::create_dir_all(&worktree_path).unwrap();

        let data: crate::projects::types::ProjectsData =
            serde_json::from_value(serde_json::json!({
                "projects": [{
                    "id": "search-p1",
                    "name": "jean",
                    "path": temp.path().join("repo"),
                    "default_branch": "main",
                    "added_at": 0,
                    "order": 0,
                }],
                "worktrees": [{
                    "id": "search-wt",
                    "project_id": "search-p1",
                    "name": "fuzzy-tiger",
                    "path": worktree_path,
                    "branch": "feature",
                    "created_at": 0,
                }],
            }))
            .unwrap();
        crate::projects::storage::save_projects_data(&app, &data).unwrap();

        crate::chat::storage::with_sessions_mut(&app, "", "search-wt", |stored| {
            stored.sessions.clear();
            let mut session = crate::chat::types::Session::new(
                "redirect notes".to_string(),
                0,
                crate::chat::types::Backend::Claude,
            );
            session.id = "search-s1".to_string();
            stored.sessions.push(session);
            Ok(())
        })
        .unwrap();

        (temp, app)
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn a_session_found_by_its_name_alone_is_still_a_hit() {
        let (_temp, app) = fixture_with_a_named_session();

        let response = block_on(search_session_messages(
            app,
            "redirect".to_string(),
            SessionSearchOptions {
                match_names: true,
                ..Default::default()
            },
        ))
        .unwrap();

        assert_eq!(response.hits.len(), 1);
        let hit = &response.hits[0];
        assert_eq!(hit.session_id, "search-s1");
        assert!(hit.name_match);
        assert!(hit.snippet.is_empty());
        assert_eq!(hit.match_count, 0);
        assert_eq!(hit.message_id, None);
    }

    #[test]
    fn the_command_palette_still_gets_message_hits_only() {
        // Asserted through the command bus, not through the core function,
        // because that is the layer the palette actually calls: it sends the
        // query and nothing else. A wrong default in the dispatch arm would
        // start showing every session title as a search result.
        let (_temp, app) = fixture_with_a_named_session();

        let raw = block_on(crate::http_server::dispatch::dispatch_command(
            &app,
            "search_session_messages",
            serde_json::json!({ "query": "redirect" }),
        ))
        .unwrap();
        let response: SessionSearchResponse = serde_json::from_value(raw).unwrap();

        assert!(response.hits.is_empty());
    }

    #[test]
    fn the_dispatch_arm_passes_every_option_through() {
        let (_temp, app) = fixture_with_a_named_session();

        let raw = block_on(crate::http_server::dispatch::dispatch_command(
            &app,
            "search_session_messages",
            serde_json::json!({
                "query": "redirect",
                "matchNames": true,
                "projectId": "search-p1",
                "includeArchived": true,
                "limit": 5,
            }),
        ))
        .unwrap();
        let response: SessionSearchResponse = serde_json::from_value(raw).unwrap();

        assert_eq!(response.hits.len(), 1);
        assert!(response.hits[0].name_match);

        // snake_case keys work too, as everywhere else on the command bus.
        let raw = block_on(crate::http_server::dispatch::dispatch_command(
            &app,
            "search_session_messages",
            serde_json::json!({
                "query": "redirect",
                "match_names": true,
                "project_id": "nope",
            }),
        ))
        .unwrap();
        let response: SessionSearchResponse = serde_json::from_value(raw).unwrap();

        assert!(response.hits.is_empty());
    }

    #[test]
    fn the_project_filter_excludes_other_projects() {
        let (_temp, app) = fixture_with_a_named_session();

        let mine = block_on(search_session_messages(
            app.clone(),
            "redirect".to_string(),
            SessionSearchOptions {
                match_names: true,
                project_id: Some("search-p1".to_string()),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(mine.hits.len(), 1);

        let elsewhere = block_on(search_session_messages(
            app,
            "redirect".to_string(),
            SessionSearchOptions {
                match_names: true,
                project_id: Some("other".to_string()),
                ..Default::default()
            },
        ))
        .unwrap();
        assert!(elsewhere.hits.is_empty());
    }

    #[test]
    fn an_archived_session_is_hidden_until_it_is_asked_for() {
        let (_temp, app) = fixture_with_a_named_session();
        crate::chat::storage::with_sessions_mut(&app, "", "search-wt", |stored| {
            stored.sessions[0].archived_at = Some(1);
            Ok(())
        })
        .unwrap();

        let hidden = block_on(search_session_messages(
            app.clone(),
            "redirect".to_string(),
            SessionSearchOptions {
                match_names: true,
                ..Default::default()
            },
        ))
        .unwrap();
        assert!(hidden.hits.is_empty());

        let shown = block_on(search_session_messages(
            app,
            "redirect".to_string(),
            SessionSearchOptions {
                match_names: true,
                include_archived: true,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(shown.hits.len(), 1);
    }
}
