pub(crate) mod antigravity;
pub mod artifacts;
pub(crate) mod claude;
pub mod claude_dialog;
pub(crate) mod claude_dialog_tool;
pub(crate) mod coalesce;
pub(crate) mod codex;
pub(crate) mod codex_server;
pub(crate) mod commandcode;
mod commands;
pub(crate) mod context_instructions;
pub(crate) mod cursor;
pub mod detached;
pub mod follow_ups;
pub mod fork;
pub(crate) mod grok;
pub(crate) mod handoff;
pub mod jean_mcp;
pub(crate) mod kimi;
mod naming;
mod native_history;
pub(crate) mod opencode;
pub mod overview;
pub(crate) mod pi;
pub mod project_preset;
pub mod recap;
pub mod registry;
pub mod run_log;
pub mod run_secrets;
pub mod schedules;
pub mod search;
pub mod session_links;
pub mod session_move;
pub mod storage;
pub mod tail;
pub mod todo;
pub mod transfer;
pub mod types;

pub use artifacts::edit_session_artifacts;
pub use commands::*;
pub use follow_ups::edit_session_follow_ups;
pub use fork::fork_session_in_place;
pub use native_history::*;
pub use storage::{preserve_base_sessions, restore_base_sessions, with_sessions_mut};
pub use todo::set_session_todo;
pub use transfer::{export_session_bundle, import_session_bundle, SessionBundle};

use std::sync::atomic::{AtomicUsize, Ordering};

/// End-of-turn recap instruction. Appended to every backend's system prompt so
/// the assistant terminates multi-step turns with a single `## Recap` markdown
/// block. The compact view in `CompactMessageList.tsx` extracts that block and
/// renders it as the visible summary instead of the full latest assistant text.
pub const RECAP_INSTRUCTION: &str = "## End-of-turn recap

When you finish a turn that involved tool calls, edits, or multi-step work, end your response with a final markdown section like this:

## Recap

[If the user asked a question or requested a specific output, restate the actual answer/result here so the recap stands alone as the deliverable. Use a short paragraph, table, or list — whichever fits the answer best.]

- 2-4 short bullets for context that doesn't fit above: caveats, follow-ups, unresolved questions, or files the user should review.

[Optional `### How to test` subsection — include ONLY when the rules below say to.]

Rules:
- Heading must be the literal string `## Recap` on its own line.
- Place it as the LAST block of the message, after any prose.
- The recap is the user-facing deliverable — it must be self-contained. Include the actual answer/result inline. Do NOT write things like \"I looked it up\" or \"see above\" — restate the answer.
- Add a `### How to test` subsection ONLY when the turn produced code, config, or behavior changes the user can verify. Make it actionable and specific (commands to run, UI flows to click through, files to inspect); if it makes sense, always include a smoke test that explains how the user can manually verify the main behavior. OMIT the subsection entirely on read-only turns — questions, explanations, research, planning, code review without edits, or any turn where there is nothing meaningful to test. Do NOT include placeholder content like \"N/A\", \"Nothing to test\", \"No tests needed\", or an empty bullet list. If in doubt, leave it out.
- In plan mode, when a plan is ready, you MUST still call the native plan tool (Claude ExitPlanMode, Codex `<proposed_plan>` / plan item, Cursor/OpenCode equivalent) to present it. The recap does NOT replace the plan tool — never end a plan-mode turn with only a `## Recap` block in place of the plan tool call.
- Skip the recap entirely if the turn was a single one-line answer with no tool calls.
- Do NOT repeat tool inputs, file diffs, or raw command output verbatim. Summarize.";

/// Where results go. Appended to every chat send, also when recaps are off:
/// the chat shows tool calls collapsed, and models like to "present" a finding
/// by printing it with `echo` in a shell command, so it looks lost. It also
/// names the fenced blocks the chat renders (`code-block-renderers.ts`), so a
/// model knows it can show a diagram, a chart or an HTML page inline.
/// Structured one-shots (`include_recap == false`) skip it.
pub const CHAT_OUTPUT_INSTRUCTION: &str = "The user sees tool output only collapsed. Put findings and results in chat text, never in echo/printf output. After \"Here is what I found:\", write the content, not a tool call. The chat draws fenced ```mermaid and ```vega-lite blocks as diagrams and charts, and shows a fenced ```html or ```svg block with an inline preview (sandboxed, no network).";

pub(crate) fn should_add_recap_instruction(app: &tauri::AppHandle) -> bool {
    should_include_recap_instruction(app, true)
}

/// Whether this send should append `RECAP_INSTRUCTION`.
///
/// `include_recap` is the per-send override. Structured deliverables such as
/// magic release notes set this to `false` so the recap does not replace the
/// actual output.
pub(crate) fn should_include_recap_instruction(
    app: &tauri::AppHandle,
    include_recap: bool,
) -> bool {
    recap_instruction_enabled(
        include_recap,
        crate::load_preferences_sync(app)
            .map(|preferences| preferences.auto_recaps_enabled)
            .unwrap_or(true),
    )
}

pub(crate) fn recap_instruction_enabled(include_recap: bool, auto_recaps_enabled: bool) -> bool {
    include_recap && auto_recaps_enabled
}

#[cfg(test)]
mod tests {
    use super::{CHAT_OUTPUT_INSTRUCTION, RECAP_INSTRUCTION};

    #[test]
    fn chat_output_rule_keeps_findings_out_of_echo_output() {
        assert!(CHAT_OUTPUT_INSTRUCTION.contains("collapsed"));
        assert!(CHAT_OUTPUT_INSTRUCTION.contains("echo/printf"));
        assert!(CHAT_OUTPUT_INSTRUCTION.contains("not a tool call"));
        // The rich blocks the chat renders (code-block-renderers.ts).
        for lang in ["mermaid", "vega-lite", "html", "svg"] {
            assert!(
                CHAT_OUTPUT_INSTRUCTION.contains(&format!("```{lang}")),
                "{lang}"
            );
        }
        // Short on purpose: it rides along with every chat send.
        assert!(CHAT_OUTPUT_INSTRUCTION.len() < 400);
    }

    /// Every prompt builder that adds the recap rule must also add the chat
    /// output rule, so a new backend cannot leave it out.
    #[test]
    fn every_prompt_builder_adds_the_chat_output_rule() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/chat");
        let mut checked = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let code = text.split("#[cfg(test)]").next().unwrap_or("");
            let recap = code.matches("push(super::RECAP_INSTRUCTION").count();
            let output = code.matches("push(super::CHAT_OUTPUT_INSTRUCTION").count();
            assert_eq!(recap, output, "{}", path.display());
            checked += recap;
        }
        assert!(checked >= 8, "found only {checked} prompt builders");
    }

    #[test]
    fn recap_how_to_test_rule_requests_manual_smoke_test_when_useful() {
        assert!(RECAP_INSTRUCTION.contains("smoke test"));
        assert!(RECAP_INSTRUCTION.contains("manual"));
        assert!(RECAP_INSTRUCTION.contains("if it makes sense"));
    }

    #[test]
    fn recap_instruction_is_skipped_when_send_disables_it() {
        assert!(!super::recap_instruction_enabled(false, true));
        assert!(!super::recap_instruction_enabled(false, false));
        assert!(!super::recap_instruction_enabled(true, false));
        assert!(super::recap_instruction_enabled(true, true));
    }
}

/// Global counter for active file tailers (sessions being streamed)
static ACTIVE_TAILER_COUNT: once_cell::sync::Lazy<AtomicUsize> =
    once_cell::sync::Lazy::new(|| AtomicUsize::new(0));

pub fn increment_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn decrement_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_sub(1, Ordering::Relaxed);
}

/// Run-log tailers streaming right now (memory report, issue #97).
pub(crate) fn active_tailer_count() -> usize {
    ACTIVE_TAILER_COUNT.load(Ordering::Relaxed)
}

/// Native CLI history cache entries (memory report, issue #97).
pub(crate) fn native_history_cache_len() -> usize {
    native_history::cache_len()
}
