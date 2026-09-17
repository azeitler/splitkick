//! The `permission_prompt` MCP tool.
//!
//! Claude Code calls this for every permission decision once Jean passes
//! `--permission-prompt-tool`. Three shapes matter:
//!
//! * `AskUserQuestion` — park on the Jean UI, return the picked answers.
//! * `ExitPlanMode` / `EnterPlanMode` — park on the plan approval UI.
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
    app: &AppHandle,
    arguments: Value,
    source: &str,
) -> Result<Value, ToolError> {
    let tool_name = arguments
        .get("tool_name")
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::invalid_params("permission_prompt: missing 'tool_name'"))?
        .to_string();
    let input = arguments.get("input").cloned().unwrap_or_else(|| json!({}));
    let tool_use_id = arguments
        .get("tool_use_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let execution_mode = crate::chat::registry::current_execution_mode(source);

    let outcome = match tool_name.as_str() {
        "AskUserQuestion" => {
            if tool_use_id.is_empty() {
                // Without an id the UI answer cannot be matched back. Deny with
                // a message the model can act on instead of parking forever.
                DialogOutcome::Denied {
                    message: "Jean could not match this question to a tool call.".to_string(),
                }
            } else {
                claude_dialog::park(app, source, &tool_use_id, "question").await
            }
        }
        "ExitPlanMode" | "EnterPlanMode" => {
            if tool_use_id.is_empty() {
                DialogOutcome::Denied {
                    message: "Jean could not match this plan to a tool call.".to_string(),
                }
            } else {
                claude_dialog::park(app, source, &tool_use_id, "plan").await
            }
        }
        other => {
            // Not a dialog: reproduce the mode's own verdict.
            match execution_mode.as_deref() {
                // build/yolo auto-approve before the CLI ever consults us, so
                // reaching here at all means an ask-tier tool; allow it to keep
                // the modes behaving as they did before the flag existed.
                Some("build") | Some("yolo") => DialogOutcome::Approved,
                _ if is_plan_mode_allowed(other) => DialogOutcome::Approved,
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
    fn text_result_wraps_the_payload_as_one_text_block() {
        let wrapped = text_result(json!({"behavior": "allow"}));
        let text = wrapped["content"][0]["text"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(parsed["behavior"], "allow");
    }
}
