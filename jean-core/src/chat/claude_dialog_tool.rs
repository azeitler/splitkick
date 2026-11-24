//! The `permission_prompt` MCP tool.
//!
//! Claude Code calls this for every permission decision once Jean passes
//! `--permission-prompt-tool`. Three shapes matter:
//!
//! * `AskUserQuestion` / `ExitPlanMode` — end the turn. The session waits,
//!   and the answer or approval starts the next turn as a new message.
//! * everything else — reproduce the execution mode's own verdict, because
//!   naming a permission-prompt tool takes the decision away from the CLI.
//!
//! See [`crate::chat::claude_dialog`] for why answers travel this way.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::chat::claude_dialog::{self, DialogOutcome};
use crate::jean_mcp_core::ToolError;

/// Tools Claude may use in plan mode without asking.
///
/// Mirrors what plan mode allows on its own, so wiring Jean in as the
/// permission responder does not silently widen or narrow plan mode. Reads and
/// research are fine; anything that mutates the worktree is not.
const PLAN_MODE_ALLOWED: &[&str] = &[
    "Agent",
    "Explore",
    "Glob",
    "Grep",
    "NotebookRead",
    "Read",
    "Task",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
];

/// MCP tools are already allowlisted on the CLI side via `--allowedTools`, so
/// denying them here would contradict the flags Jean itself passes.
const PLAN_MODE_ALLOWED_PREFIXES: &[&str] = &["mcp__"];

fn is_plan_mode_allowed(tool_name: &str) -> bool {
    if PLAN_MODE_ALLOWED.contains(&tool_name) {
        return true;
    }
    if PLAN_MODE_ALLOWED_PREFIXES
        .iter()
        .any(|p| tool_name.starts_with(p))
    {
        return true;
    }
    // Bash is read-only often enough that a blanket deny would make plan mode
    // useless, and the CLI itself permits it in plan mode for research.
    tool_name == "Bash"
}

/// Whether a file tool targets Claude's own plan file.
///
/// In plan mode the CLI asks the permission tool before it writes the plan
/// (`<config dir>/plans/<name>.md`). Native plan mode allows that one path, and
/// `ExitPlanMode` reads the plan from it, so denying it left the plan empty
/// (#136). A Claude config dir always holds `projects/`; that keeps a repo's own
/// `plans/` folder out of this exception.
fn is_plan_file_write(tool_name: &str, input: &Value) -> bool {
    if !matches!(tool_name, "Write" | "Edit" | "MultiEdit") {
        return false;
    }
    let Some(path) = input.get("file_path").and_then(Value::as_str) else {
        return false;
    };
    let path = std::path::Path::new(path);
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        return false;
    }
    let Some(plans_dir) = path.parent() else {
        return false;
    };
    plans_dir.file_name().and_then(|n| n.to_str()) == Some("plans")
        && plans_dir
            .parent()
            .is_some_and(|config_dir| config_dir.join("projects").is_dir())
}

fn text_result(payload: Value) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string()),
        }],
        "isError": false,
    })
}

pub async fn handle_permission_prompt(
    _app: &AppHandle,
    arguments: Value,
    source: &str,
) -> Result<Value, ToolError> {
    let tool_name = arguments
        .get("tool_name")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::invalid_params("permission_prompt: missing 'tool_name'"))?
        .to_string();
    let input = arguments.get("input").cloned().unwrap_or_else(|| json!({}));
    let execution_mode = crate::chat::registry::current_execution_mode(source);

    let outcome = match tool_name.as_str() {
        // A question or plan ends the turn: the session waits in its saved
        // state, and the answer or approval starts the next turn as a new
        // message. The tailer ends the run at the same call (`claude.rs`).
        "AskUserQuestion" | "ExitPlanMode" => DialogOutcome::EndTurn,
        // Entering plan mode needs no approval.
        "EnterPlanMode" => DialogOutcome::Approved,
        other => {
            // Not a dialog: reproduce the mode's own verdict.
            match execution_mode.as_deref() {
                // build/yolo auto-approve before the CLI ever consults us, so
                // reaching here at all means an ask-tier tool; allow it to keep
                // the modes behaving as they did before the flag existed.
                Some("build") | Some("yolo") => DialogOutcome::Approved,
                _ if is_plan_mode_allowed(other) => DialogOutcome::Approved,
                _ if is_plan_file_write(other, &input) => DialogOutcome::Approved,
                _ => DialogOutcome::Denied {
                    message: format!(
                        "{other} is not permitted in plan mode. Present a plan with ExitPlanMode \
                         and wait for approval before making changes."
                    ),
                },
            }
        }
    };

    Ok(text_result(claude_dialog::permission_payload(
        &outcome, &input,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_mode_allows_research_and_reads() {
        for tool in ["Read", "Grep", "Glob", "WebFetch", "Task", "Bash"] {
            assert!(is_plan_mode_allowed(tool), "{tool} should be allowed");
        }
    }

    #[test]
    fn plan_mode_denies_mutations() {
        for tool in ["Write", "Edit", "NotebookEdit"] {
            assert!(!is_plan_mode_allowed(tool), "{tool} should be denied");
        }
    }

    #[test]
    fn plan_mode_allows_mcp_tools() {
        // Jean's own MCP tools are already allowlisted on the CLI side; denying
        // them here would contradict --allowedTools.
        assert!(is_plan_mode_allowed("mcp__jean__get_current_context"));
    }

    #[test]
    fn plan_mode_allows_writing_the_plan_file_only() {
        let config_dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(config_dir.path().join("projects")).unwrap();
        std::fs::create_dir_all(config_dir.path().join("plans")).unwrap();
        let plan = config_dir.path().join("plans").join("a-plan.md");
        let input = json!({"file_path": plan.to_string_lossy(), "content": "# Plan"});
        assert!(is_plan_file_write("Write", &input));
        assert!(is_plan_file_write("Edit", &input));
        assert!(!is_plan_file_write("Bash", &input));

        // A repo's own plans/ folder is not the Claude plan directory.
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(repo.path().join("plans")).unwrap();
        let repo_plan = repo.path().join("plans").join("a-plan.md");
        assert!(!is_plan_file_write(
            "Write",
            &json!({"file_path": repo_plan.to_string_lossy()})
        ));
        // Only markdown files directly in plans/.
        let other = config_dir.path().join("plans").join("x.sh");
        assert!(!is_plan_file_write(
            "Write",
            &json!({"file_path": other.to_string_lossy()})
        ));
    }

    /// A question or plan ends the turn at once: nothing waits in memory, so
    /// the session's saved state is the one place that says it waits.
    #[test]
    fn a_question_or_plan_ends_the_turn_at_once() {
        let temp = tempfile::tempdir().unwrap();
        let app =
            crate::runtime::RuntimeContext::new(temp.path().into(), temp.path().into()).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for tool in ["AskUserQuestion", "ExitPlanMode"] {
            let result = runtime
                .block_on(handle_permission_prompt(
                    &app,
                    json!({"tool_name": tool, "input": {}, "tool_use_id": "toolu_end"}),
                    "session-end-turn",
                ))
                .unwrap();
            let payload: Value =
                serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(payload["behavior"], "deny", "{tool}");
            assert_eq!(payload["interrupt"], true, "{tool}");
            assert!(!claude_dialog::is_parked("toolu_end"), "{tool}");
        }
    }

    #[test]
    fn text_result_wraps_the_payload_as_one_text_block() {
        let wrapped = text_result(json!({"behavior": "allow"}));
        let text = wrapped["content"][0]["text"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["behavior"], "allow");
    }
}
