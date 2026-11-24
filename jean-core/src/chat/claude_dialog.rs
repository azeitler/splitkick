//! The permission answers for Claude's dialog tools.
//!
//! Claude Code gates `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`
//! behind `--permission-prompt-tool`: under `--print` the tools are only
//! offered when the host names an MCP tool that can answer permission
//! requests. Jean's `jean-dialog` MCP server is that tool (see
//! [`crate::chat::jean_mcp`] and [`crate::chat::claude_dialog_tool`]).
//!
//! A question or plan ends the turn ([`DialogOutcome::EndTurn`]): the answer
//! is deny + `interrupt`, so the CLI closes the call as rejected in its own
//! transcript and exits. The tailer ends the run at the same call
//! (`claude.rs`), the session's saved state says that it waits, and the answer
//! or approval starts the next turn as a new message.
//!
//! Nothing waits in memory. 1.6.0 kept the run alive and parked the call here
//! until the UI answered (#136); the waiting state then lived only in this
//! process, and every client that missed its one event showed the session as
//! running (#155, #159). Do not bring that back without a saved state.

use serde_json::{json, Value};

/// The answer to one permission request.
#[derive(Debug, Clone)]
pub enum DialogOutcome {
    /// Permission granted with the tool's input unchanged.
    Approved,
    /// Permission refused; the model reads the message and goes on.
    Denied { message: String },
    /// End the turn at a question or plan: the CLI closes the call as
    /// rejected, writes that to its transcript and exits. The session then
    /// waits, and the answer resumes it as a new message.
    EndTurn,
}

/// Denial text of [`DialogOutcome::EndTurn`], read only by a CLI without
/// `interrupt`.
pub const END_TURN_MESSAGE: &str = "The user has not answered yet. End your turn now and call \
no more tools. The answer follows in the next user message.";

/// Build the MCP `permission_prompt` payload Claude expects back.
pub fn permission_payload(outcome: &DialogOutcome, original_input: &Value) -> Value {
    match outcome {
        DialogOutcome::Approved => {
            json!({ "behavior": "allow", "updatedInput": original_input })
        }
        DialogOutcome::Denied { message } => {
            json!({ "behavior": "deny", "message": message })
        }
        // `interrupt` ends the turn instead of handing the model a denial to
        // react to (it asks again, or goes on without the answer). The CLI
        // writes its own "rejected, wait for the user" result; the message is
        // for a CLI that does not know `interrupt`.
        DialogOutcome::EndTurn => json!({
            "behavior": "deny",
            "message": END_TURN_MESSAGE,
            "interrupt": true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A question or plan ends the turn: deny with `interrupt`, so the CLI
    /// closes the call and exits instead of handing the model a denial.
    #[test]
    fn ending_the_turn_denies_with_interrupt() {
        let payload = permission_payload(&DialogOutcome::EndTurn, &json!({"questions": []}));
        assert_eq!(payload["behavior"], "deny");
        assert_eq!(payload["interrupt"], true);
        assert_eq!(payload["message"], END_TURN_MESSAGE);
    }

    #[test]
    fn approval_keeps_the_input_untouched() {
        let input = json!({"plan": "# Plan\n- do the thing"});
        let payload = permission_payload(&DialogOutcome::Approved, &input);
        assert_eq!(payload["behavior"], "allow");
        assert_eq!(payload["updatedInput"]["plan"], "# Plan\n- do the thing");
    }

    #[test]
    fn denial_carries_the_message_and_no_input() {
        let payload = permission_payload(
            &DialogOutcome::Denied {
                message: "nope".to_string(),
            },
            &json!({"questions": []}),
        );
        assert_eq!(payload["behavior"], "deny");
        assert_eq!(payload["message"], "nope");
        assert!(payload.get("updatedInput").is_none());
    }
}
