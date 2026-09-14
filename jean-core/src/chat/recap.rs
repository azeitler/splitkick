//! Extract the `## Recap` block an agent writes at the end of a turn.
//!
//! `RECAP_INSTRUCTION` (see `chat/mod.rs`) asks every backend to end a
//! multi-step turn with a `## Recap` section. That block is a summary of the
//! session's state written by the agent itself, so reading it costs nothing at
//! inference time. `list_all_sessions` uses it to answer "can this session be
//! closed?" without reading any message history.
//!
//! This is a port of `src/components/chat/recap-utils.ts`. Keep the two in
//! step: the frontend hides the recap from the message list, this module hands
//! it to MCP clients, and a reader that disagrees with the renderer is worse
//! than no reader at all.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::chat::run_log::{get_run_log_path, load_session_messages_window};
use crate::chat::storage::load_metadata;
use crate::chat::types::{ChatMessage, ContentBlock, MessageRole};

/// Longest recap returned to a client. A recap is a summary already; anything
/// past this is prose the caller can fetch with `read_session_messages`.
pub const RECAP_MAX_CHARS: usize = 500;

/// How many runs back to look for a recap. The recap of interest is the one
/// that describes where the session stopped, so only the newest runs matter.
const RECAP_LOOKBACK_RUNS: usize = 3;

/// Literal the byte gate looks for. `RECAP_INSTRUCTION` requires this exact
/// string on its own line, and JSONL escapes newlines inside the JSON string,
/// so the bytes survive into the run log.
const RECAP_MARKER: &str = "## Recap";

/// The recap heading, alone on its line.
///
/// Deliberately tighter than the `\s` of `recap-utils.ts`: `\s` matches a
/// newline in Rust as it does in JavaScript, so `##\s*$` can swallow the line
/// break and anchor `$` further down the text, which moves the start of the
/// section. `[ \t]` cannot.
static RECAP_HEADING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?im)^##[ \t]+Recap[ \t]*$").unwrap());

/// Heading that ends the recap section. `###` is not included, so an optional
/// `### How to test` subsection stays part of the recap.
static NEXT_HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#{1,2}[ \t]").unwrap());

/// Cut `text` to `max_chars` characters on a character boundary.
///
/// Appends an ellipsis when it cuts, so the caller can see the text is partial.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_none() {
        head
    } else {
        format!("{head}…")
    }
}

/// Return the first `## Recap` section of `text`, heading included.
///
/// The section runs to the next `#` or `##` heading, or to the end of the text.
pub fn extract_recap_section(text: &str) -> Option<String> {
    let heading = RECAP_HEADING_RE.find(text)?;
    let after_heading = heading.end();
    let end = NEXT_HEADING_RE
        .find(&text[after_heading..])
        .map(|m| after_heading + m.start())
        .unwrap_or(text.len());

    let section = text[heading.start()..end].trim();
    if section.is_empty() {
        None
    } else {
        Some(section.to_string())
    }
}

/// Text of one message as the recap reader sees it.
///
/// Prefers the ordered text blocks, because a parser may leave `content` empty
/// when it filled `content_blocks`. Thinking and tool blocks never hold a recap.
fn message_text(message: &ChatMessage) -> String {
    let texts: Vec<&str> = message
        .content_blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } if !text.trim().is_empty() => Some(text.as_str()),
            _ => None,
        })
        .collect();

    if texts.is_empty() {
        message.content.clone()
    } else {
        texts.join("\n\n")
    }
}

/// Return the recap of the newest assistant message that has one.
pub fn latest_recap_from_messages(messages: &[ChatMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .filter(|message| message.role == MessageRole::Assistant)
        .find_map(|message| extract_recap_section(&message_text(message)))
}

/// Read the newest recap of a session, or `None` when it has none.
///
/// Cheap by design, because `list_all_sessions` calls this once per returned
/// session. It walks at most `RECAP_LOOKBACK_RUNS` runs back and gates each one
/// on a raw byte scan of the run log — the same trick as `search::run_logs_contain`,
/// but case-sensitive, so it does not copy the file to lowercase it. Only a run
/// that clears the gate is parsed, and then only that single run.
///
/// Every error is swallowed: a session without a readable recap must degrade to
/// "no recap", never fail the whole listing.
pub fn latest_recap_for_session(app: &tauri::AppHandle, session_id: &str) -> Option<String> {
    let metadata = load_metadata(app, session_id).ok().flatten()?;

    let mut looked_at = 0;
    for index in (0..metadata.runs.len()).rev() {
        if looked_at >= RECAP_LOOKBACK_RUNS {
            break;
        }
        let run = &metadata.runs[index];
        if run.assistant_message_id.is_none() {
            continue;
        }
        looked_at += 1;

        let Ok(path) = get_run_log_path(app, session_id, &run.run_id) else {
            continue;
        };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        if !raw.contains(RECAP_MARKER) {
            continue;
        }

        // The gate hit. Parse this one run and nothing else.
        let Ok(loaded) = load_session_messages_window(app, session_id, Some(1), Some(index + 1))
        else {
            continue;
        };
        if let Some(recap) = latest_recap_from_messages(&loaded.messages) {
            return Some(truncate_chars(&recap, RECAP_MAX_CHARS));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant(content: &str) -> ChatMessage {
        ChatMessage {
            role: MessageRole::Assistant,
            content: content.to_string(),
            ..Default::default()
        }
    }

    fn user(content: &str) -> ChatMessage {
        ChatMessage {
            role: MessageRole::User,
            ..assistant(content)
        }
    }

    #[test]
    fn extracts_a_recap_section() {
        let text = "Did the work.\n\n## Recap\n\n- Fixed the parser.\n- Added a test.";
        let recap = extract_recap_section(text).unwrap();

        assert_eq!(recap, "## Recap\n\n- Fixed the parser.\n- Added a test.");
    }

    #[test]
    fn returns_none_without_a_heading() {
        assert_eq!(extract_recap_section("Just prose, no recap here."), None);
    }

    #[test]
    fn stops_at_the_next_top_level_heading() {
        let text = "## Recap\n\nDone.\n\n## Notes\n\nNot part of the recap.";
        let recap = extract_recap_section(text).unwrap();

        assert_eq!(recap, "## Recap\n\nDone.");
        assert!(!recap.contains("Not part of the recap"));
    }

    #[test]
    fn keeps_a_how_to_test_subsection() {
        let text = "## Recap\n\nDone.\n\n### How to test\n\nRun the suite.";
        let recap = extract_recap_section(text).unwrap();

        assert!(recap.contains("### How to test"));
        assert!(recap.contains("Run the suite."));
    }

    #[test]
    fn heading_match_is_case_insensitive() {
        let recap = extract_recap_section("## RECAP\n\nDone.").unwrap();

        assert_eq!(recap, "## RECAP\n\nDone.");
    }

    #[test]
    fn a_blank_line_after_the_heading_does_not_swallow_the_body() {
        // `\s*$` would match across the blank line and move the section start.
        let recap = extract_recap_section("## Recap\n\nThe body survives.").unwrap();

        assert!(recap.contains("The body survives."));
    }

    #[test]
    fn a_recap_like_word_in_prose_is_not_a_heading() {
        assert_eq!(extract_recap_section("See the ## Recap below"), None);
        assert_eq!(extract_recap_section("### Recap\n\nToo deep."), None);
    }

    #[test]
    fn takes_the_newest_assistant_recap() {
        let messages = vec![
            assistant("## Recap\n\nFirst."),
            user("## Recap\n\nUser text is ignored."),
            assistant("## Recap\n\nSecond."),
        ];

        assert_eq!(
            latest_recap_from_messages(&messages),
            Some("## Recap\n\nSecond.".to_string())
        );
    }

    #[test]
    fn skips_assistant_messages_without_a_recap() {
        let messages = vec![assistant("## Recap\n\nFirst."), assistant("No recap here.")];

        assert_eq!(
            latest_recap_from_messages(&messages),
            Some("## Recap\n\nFirst.".to_string())
        );
    }

    #[test]
    fn prefers_text_blocks_over_content() {
        let mut message = assistant("stale content");
        message.content_blocks = vec![
            ContentBlock::Thinking {
                thinking: "## Recap\n\nThinking is not a recap.".to_string(),
            },
            ContentBlock::Text {
                text: "## Recap\n\nFrom the block.".to_string(),
            },
        ];

        assert_eq!(
            latest_recap_from_messages(&[message]),
            Some("## Recap\n\nFrom the block.".to_string())
        );
    }

    #[test]
    fn falls_back_to_content_when_there_are_no_text_blocks() {
        let mut message = assistant("## Recap\n\nFrom content.");
        message.content_blocks = vec![ContentBlock::ToolUse {
            tool_call_id: "t1".to_string(),
        }];

        assert_eq!(
            latest_recap_from_messages(&[message]),
            Some("## Recap\n\nFrom content.".to_string())
        );
    }

    #[test]
    fn truncation_keeps_short_text_whole() {
        assert_eq!(truncate_chars("short", 100), "short");
    }

    #[test]
    fn truncation_is_char_boundary_safe() {
        let text = "日本語テキストとemoji🎉🎉🎉";
        let cut = truncate_chars(text, 5);

        assert_eq!(cut, "日本語テキ…");
        assert_eq!(truncate_chars("🎉🎉🎉", 2), "🎉🎉…");
    }
    // ---- end to end, against a real temp data directory ----

    /// A session with one completed run per entry in `assistant_texts`, each
    /// with a run log on disk holding that text.
    fn session_with_runs(
        prefix: &str,
        assistant_texts: &[&str],
    ) -> (tempfile::TempDir, tauri::AppHandle) {
        let temp = tempfile::tempdir().unwrap();
        let app = tauri::AppHandle::new(temp.path().into(), temp.path().into()).unwrap();
        let worktree_id = format!("{prefix}-wt");
        let session_id = format!("{prefix}-s1");

        crate::chat::storage::with_sessions_mut(&app, "", &worktree_id, |stored| {
            stored.sessions.clear();
            let mut session = crate::chat::types::Session::new(
                "recap reader".to_string(),
                0,
                crate::chat::types::Backend::Claude,
            );
            session.id = session_id.clone();
            stored.sessions.push(session);
            Ok(())
        })
        .unwrap();

        crate::chat::storage::with_existing_metadata_mut(&app, &session_id, |metadata| {
            for (index, _) in assistant_texts.iter().enumerate() {
                metadata.runs.push(
                    serde_json::from_value(serde_json::json!({
                        "run_id": format!("run-{index}"),
                        "user_message_id": format!("u{index}"),
                        "user_message": format!("prompt {index}"),
                        "started_at": index,
                        "status": "completed",
                        "assistant_message_id": format!("a{index}"),
                    }))
                    .unwrap(),
                );
            }
        })
        .unwrap();

        for (index, text) in assistant_texts.iter().enumerate() {
            let path = get_run_log_path(&app, &session_id, &format!("run-{index}")).unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let line = serde_json::json!({
                "type": "assistant",
                "message": { "content": [{ "type": "text", "text": text }] },
            });
            std::fs::write(&path, format!("{line}\n")).unwrap();
        }

        (temp, app)
    }

    #[test]
    fn reads_the_recap_of_the_newest_run() {
        let (_temp, app) = session_with_runs(
            "newest",
            &[
                "## Recap\n\nThe old turn.",
                "Prose only.\n\n## Recap\n\nThe newest turn.",
            ],
        );

        let recap = latest_recap_for_session(&app, "newest-s1").unwrap();

        assert_eq!(recap, "## Recap\n\nThe newest turn.");
    }

    #[test]
    fn looks_back_past_runs_that_wrote_no_recap() {
        let (_temp, app) = session_with_runs(
            "lookback",
            &["## Recap\n\nThe only recap.", "A one-line answer."],
        );

        assert_eq!(
            latest_recap_for_session(&app, "lookback-s1"),
            Some("## Recap\n\nThe only recap.".to_string())
        );
    }

    #[test]
    fn gives_up_after_the_lookback_window() {
        // Four runs, only the oldest has a recap. Reading every run of a long
        // session would defeat the point of a cheap listing.
        let (_temp, app) = session_with_runs(
            "window",
            &[
                "## Recap\n\nToo far back.",
                "no recap",
                "no recap",
                "no recap",
            ],
        );

        assert_eq!(latest_recap_for_session(&app, "window-s1"), None);
    }

    #[test]
    fn a_session_without_a_recap_returns_none_instead_of_failing() {
        let (_temp, app) = session_with_runs("plain", &["Just an answer."]);

        assert_eq!(latest_recap_for_session(&app, "plain-s1"), None);
        assert_eq!(latest_recap_for_session(&app, "does-not-exist"), None);
    }

    #[test]
    fn a_long_recap_is_cut_to_the_cap() {
        let long = format!("## Recap\n\n{}", "x".repeat(RECAP_MAX_CHARS * 2));
        let (_temp, app) = session_with_runs("long", &[&long]);

        let recap = latest_recap_for_session(&app, "long-s1").unwrap();

        assert_eq!(recap.chars().count(), RECAP_MAX_CHARS + 1);
        assert!(recap.ends_with('…'));
    }
}
