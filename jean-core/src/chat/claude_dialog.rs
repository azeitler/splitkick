//! Pending Claude dialog registry.
//!
//! Claude Code gates `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`
//! behind `--permission-prompt-tool`: under `--print` the tools are only
//! offered when the host names an MCP tool that can answer permission
//! requests. Those three tools always return `behavior: "ask"`, and the
//! *answers ride back inside the permission response* — `AskUserQuestion`'s
//! `call()` is a passthrough that reads `answers` out of its own input.
//!
//! So Jean answers them over MCP rather than over Claude's stdin, which is
//! closed by the detached `cat input | claude >> output` spawn. The dedicated
//! `jean-dialog` MCP server (see [`crate::chat::jean_mcp`]) parks a call here
//! until the UI resolves it through `answer_claude_dialog`.
//!
//! The run stays alive while a dialog is parked (#136): the answer is the tool
//! result of the same call. A plan approval with a mode returns `setMode
//! acceptEdits` and moves the registry's turn mode to build/yolo, so the run
//! leaves plan mode in the same turn. A new message instead of an answer skips
//! the dialog ([`skip_session`]); the model ends its turn and the message runs
//! next. Only a run without the harness, or one that ended (app restart), falls
//! back to the answer as a new message.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::oneshot;

use crate::http_server::EmitExt;

/// How long a dialog may park before Jean gives up on it.
///
/// The CLI's own ceiling is the per-server `timeout` Jean sets on the
/// `jean-dialog` MCP entry; this is the parent-side twin so a dialog whose
/// session died cannot leak a waiter forever. Kept slightly under the CLI
/// value so Jean answers first and the model gets a real `deny` rather than
/// an opaque MCP timeout.
pub const DIALOG_PARK_TIMEOUT: Duration = Duration::from_secs(25 * 60);

/// What the UI decided about a parked dialog.
#[derive(Debug, Clone)]
pub enum DialogOutcome {
    /// Questions answered: question text -> selected label(s).
    Answered {
        answers: Value,
        /// Freeform text the user typed instead of picking an option.
        response: Option<String>,
    },
    /// Permission granted with the tool's input unchanged.
    Approved,
    /// Plan approved in its own turn (`ExitPlanMode`): the run leaves plan
    /// mode and goes on in `mode` (`build` or `yolo`).
    PlanApproved { mode: String },
    /// User declined, or the turn was cancelled out from under the dialog.
    Denied { message: String },
}

struct PendingDialog {
    session_id: String,
    /// `question` or `plan`.
    kind: String,
    responder: oneshot::Sender<DialogOutcome>,
}

static PENDING: Lazy<Mutex<HashMap<String, PendingDialog>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Park until the UI answers `tool_use_id`, or the timeout expires.
///
/// The caller is the MCP `permission_prompt` handler, running on the socket
/// task — blocking here blocks only that one MCP call, not the app.
pub async fn park(
    app: &AppHandle,
    session_id: &str,
    tool_use_id: &str,
    kind: &str,
) -> DialogOutcome {
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = PENDING.lock().unwrap();
        // A retried tool_use_id replaces the old waiter; the stale one resolves
        // as denied so its MCP call unblocks instead of leaking.
        if let Some(previous) = pending.insert(
            tool_use_id.to_string(),
            PendingDialog {
                session_id: session_id.to_string(),
                kind: kind.to_string(),
                responder: tx,
            },
        ) {
            let _ = previous.responder.send(DialogOutcome::Denied {
                message: "Superseded by a newer request for the same tool call.".to_string(),
            });
        }
    }

    // Tell the UI a turn is parked on user input. The tool_use block itself
    // already streams through the normal chat path, so this only drives the
    // waiting-state affordances (canvas badge, sidebar dot, notifications).
    let _ = app.emit_all(
        "claude:dialog-waiting",
        &json!({
            "sessionId": session_id,
            "toolUseId": tool_use_id,
            "kind": kind,
        }),
    );

    let outcome = match tokio::time::timeout(DIALOG_PARK_TIMEOUT, rx).await {
        Ok(Ok(outcome)) => outcome,
        // Sender dropped without answering (session cancelled, app shutting down).
        Ok(Err(_)) => DialogOutcome::Denied {
            message: "Splitkick closed this request before it was answered.".to_string(),
        },
        Err(_) => {
            PENDING.lock().unwrap().remove(tool_use_id);
            DialogOutcome::Denied {
                message: "Timed out waiting for the user to respond.".to_string(),
            }
        }
    };

    let _ = app.emit_all(
        "claude:dialog-resolved",
        &json!({
            "sessionId": session_id,
            "toolUseId": tool_use_id,
        }),
    );

    outcome
}

/// Resolve a parked dialog without checking that its turn still lives.
///
/// Test-only. Production goes through [`resolve_live`]: a shim outlives the CLI
/// it answered for, so an unchecked resolve reports a dead turn as answered and
/// the UI drops the follow-up message.
#[cfg(test)]
pub fn resolve(tool_use_id: &str, outcome: DialogOutcome) -> bool {
    let Some(pending) = PENDING.lock().unwrap().remove(tool_use_id) else {
        return false;
    };
    pending.responder.send(outcome).is_ok()
}

/// Resolve a parked dialog only when its turn can still take the answer.
///
/// A `permission_prompt` request can reach Jean after the blocking-tool kill
/// released the session's dialogs: the shim outlives the CLI. That waiter
/// belongs to a dead turn, so report `false` and let the caller send the
/// answer as a new message.
pub fn resolve_live(
    tool_use_id: &str,
    outcome: DialogOutcome,
    is_live: impl Fn(&str) -> bool,
) -> bool {
    let Some(pending) = PENDING.lock().unwrap().remove(tool_use_id) else {
        return false;
    };
    if !is_live(&pending.session_id) {
        // Unblock the orphaned shim so it exits.
        let _ = pending.responder.send(DialogOutcome::Denied {
            message: "The turn that asked this has ended.".to_string(),
        });
        return false;
    }
    pending.responder.send(outcome).is_ok()
}

/// Apply one outcome to every dialog parked for a session.
///
/// Used by plan approval, which resolves the parked `ExitPlanMode` without
/// needing to thread the tool_use id through the plan UI.
pub fn resolve_session(session_id: &str, outcome: DialogOutcome) -> usize {
    let drained: Vec<PendingDialog> = {
        let mut pending = PENDING.lock().unwrap();
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, p)| p.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter().filter_map(|id| pending.remove(id)).collect()
    };
    let count = drained.len();
    for pending in drained {
        let _ = pending.responder.send(outcome.clone());
    }
    count
}

/// Deny every dialog parked for a session. Called when a run is cancelled so
/// the detached CLI does not sit on an MCP call nothing will ever answer.
pub fn cancel_session(session_id: &str) -> usize {
    let drained: Vec<PendingDialog> = {
        let mut pending = PENDING.lock().unwrap();
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, p)| p.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter().filter_map(|id| pending.remove(id)).collect()
    };
    let count = drained.len();
    for pending in drained {
        let _ = pending.responder.send(DialogOutcome::Denied {
            message: "The user cancelled this turn.".to_string(),
        });
    }
    count
}

/// Deny every dialog parked for a session because the user sent a new message
/// instead of answering (#141). The model is told to end its turn, so the run
/// finishes and the new message can start the next one.
pub fn skip_session(session_id: &str) -> usize {
    resolve_session(
        session_id,
        DialogOutcome::Denied {
            message: SKIPPED_BY_NEW_MESSAGE.to_string(),
        },
    )
}

/// Tool result for a dialog the user skipped by sending a new message.
pub const SKIPPED_BY_NEW_MESSAGE: &str = "The user skipped this and sent a new message \
instead. Do not continue the task in this turn: end your turn now with one short sentence \
and call no more tools. The new message follows in the next turn.";

/// Kind (`question` / `plan`) of the first dialog parked for a session, if any.
pub fn parked_kind_for_session(session_id: &str) -> Option<String> {
    PENDING
        .lock()
        .unwrap()
        .values()
        .find(|p| p.session_id == session_id)
        .map(|p| p.kind.clone())
}

/// Whether a dialog is currently parked for `tool_use_id`.
pub fn is_parked(tool_use_id: &str) -> bool {
    PENDING.lock().unwrap().contains_key(tool_use_id)
}

/// Build the MCP `permission_prompt` payload Claude expects back.
///
/// `allow` splices `updatedInput` into the tool's input before `call()` runs,
/// which is how answers reach `AskUserQuestion` — its `call()` reads `answers`
/// straight out of its own input and hands it to the model.
pub fn permission_payload(outcome: &DialogOutcome, original_input: &Value) -> Value {
    match outcome {
        DialogOutcome::Answered { answers, response } => {
            let mut updated = original_input.clone();
            if let Some(obj) = updated.as_object_mut() {
                obj.insert("answers".to_string(), answers.clone());
                if let Some(response) = response.as_ref().filter(|r| !r.trim().is_empty()) {
                    obj.insert("response".to_string(), Value::String(response.clone()));
                }
            }
            json!({ "behavior": "allow", "updatedInput": updated })
        }
        DialogOutcome::Approved => {
            json!({ "behavior": "allow", "updatedInput": original_input })
        }
        // Leave plan mode in the same turn. `acceptEdits` for build and yolo
        // alike: the CLI refuses `bypassPermissions` for a run that did not
        // start with it, and Jean's own permission verdict (the registry's turn
        // mode, see `claude_dialog_tool`) approves the rest in yolo.
        DialogOutcome::PlanApproved { .. } => json!({
            "behavior": "allow",
            "updatedInput": original_input,
            "updatedPermissions": [{
                "type": "setMode",
                "mode": "acceptEdits",
                "destination": "session",
            }],
        }),
        DialogOutcome::Denied { message } => {
            json!({ "behavior": "deny", "message": message })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_are_spliced_into_the_original_input() {
        let input = json!({
            "questions": [{"question": "Which cache?", "options": [{"label": "Redis"}]}]
        });
        let payload = permission_payload(
            &DialogOutcome::Answered {
                answers: json!({"Which cache?": "Redis"}),
                response: None,
            },
            &input,
        );
        assert_eq!(payload["behavior"], "allow");
        // The questions must survive: AskUserQuestion's call() echoes both back.
        assert!(payload["updatedInput"]["questions"].is_array());
        assert_eq!(payload["updatedInput"]["answers"]["Which cache?"], "Redis");
        assert!(payload["updatedInput"].get("response").is_none());
    }

    #[test]
    fn freeform_response_is_included_when_non_empty() {
        let payload = permission_payload(
            &DialogOutcome::Answered {
                answers: json!({}),
                response: Some("neither, use Postgres".to_string()),
            },
            &json!({"questions": []}),
        );
        assert_eq!(payload["updatedInput"]["response"], "neither, use Postgres");

        let blank = permission_payload(
            &DialogOutcome::Answered {
                answers: json!({}),
                response: Some("   ".to_string()),
            },
            &json!({"questions": []}),
        );
        assert!(blank["updatedInput"].get("response").is_none());
    }

    #[test]
    fn approval_keeps_the_input_untouched() {
        let input = json!({"plan": "# Plan\n- do the thing"});
        let payload = permission_payload(&DialogOutcome::Approved, &input);
        assert_eq!(payload["behavior"], "allow");
        assert_eq!(payload["updatedInput"]["plan"], "# Plan\n- do the thing");
    }

    /// An approved plan leaves plan mode in the same turn (#136).
    #[test]
    fn plan_approval_switches_the_run_out_of_plan_mode() {
        let input = json!({"plan": "# Plan", "planFilePath": "/tmp/plans/p.md"});
        let payload = permission_payload(
            &DialogOutcome::PlanApproved {
                mode: "yolo".to_string(),
            },
            &input,
        );
        assert_eq!(payload["behavior"], "allow");
        assert_eq!(payload["updatedInput"], input);
        assert_eq!(payload["updatedPermissions"][0]["type"], "setMode");
        assert_eq!(payload["updatedPermissions"][0]["mode"], "acceptEdits");
        assert_eq!(payload["updatedPermissions"][0]["destination"], "session");
    }

    /// A new message instead of an answer skips the parked dialog (#141) and
    /// tells the model to end the turn, so the new message can run next.
    #[tokio::test]
    async fn skip_session_denies_with_the_end_turn_message() {
        let rx = park_for_test("toolu_skip_by_message", "skip-by-message-session");
        assert_eq!(
            parked_kind_for_session("skip-by-message-session").as_deref(),
            Some("question")
        );

        assert_eq!(skip_session("skip-by-message-session"), 1);

        match rx.await.unwrap() {
            DialogOutcome::Denied { message } => assert_eq!(message, SKIPPED_BY_NEW_MESSAGE),
            other => panic!("expected a denial, got {other:?}"),
        }
        assert!(parked_kind_for_session("skip-by-message-session").is_none());
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

    #[test]
    fn resolve_reports_false_when_nothing_is_parked() {
        assert!(!resolve(
            "toolu_never_parked",
            DialogOutcome::Denied {
                message: "x".to_string()
            }
        ));
    }

    #[tokio::test]
    async fn cancel_session_denies_only_that_session() {
        let (tx_a, rx_a) = oneshot::channel();
        let (tx_b, rx_b) = oneshot::channel();
        {
            let mut pending = PENDING.lock().unwrap();
            pending.insert(
                "toolu_cancel_a".to_string(),
                PendingDialog {
                    session_id: "cancel-session-a".to_string(),
                    kind: "question".to_string(),
                    responder: tx_a,
                },
            );
            pending.insert(
                "toolu_cancel_b".to_string(),
                PendingDialog {
                    session_id: "cancel-session-b".to_string(),
                    kind: "question".to_string(),
                    responder: tx_b,
                },
            );
        }

        assert_eq!(cancel_session("cancel-session-a"), 1);
        assert!(matches!(rx_a.await.unwrap(), DialogOutcome::Denied { .. }));
        // The other session is untouched and still parked.
        assert!(is_parked("toolu_cancel_b"));

        // Leave the shared registry as we found it: PENDING is a process-wide
        // static, so a test that abandons an entry breaks its neighbours.
        assert_eq!(cancel_session("cancel-session-b"), 1);
        drop(rx_b);
    }

    fn park_for_test(tool_use_id: &str, session_id: &str) -> oneshot::Receiver<DialogOutcome> {
        let (tx, rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(
            tool_use_id.to_string(),
            PendingDialog {
                session_id: session_id.to_string(),
                kind: "question".to_string(),
                responder: tx,
            },
        );
        rx
    }

    fn answered() -> DialogOutcome {
        DialogOutcome::Answered {
            answers: json!({"Which cache?": "Redis"}),
            response: None,
        }
    }

    /// The shim outlives the killed CLI, so its request can park after the
    /// kill released the session. Reporting that answer as delivered made the
    /// UI skip the follow-up message, and the answer was lost.
    #[tokio::test]
    async fn an_answer_for_a_dead_turn_is_not_reported_as_delivered() {
        let rx = park_for_test("toolu_dead_turn", "dead-turn-session");

        assert!(!resolve_live("toolu_dead_turn", answered(), |_| false));

        // The orphaned shim is unblocked, and nothing stays parked.
        assert!(matches!(rx.await.unwrap(), DialogOutcome::Denied { .. }));
        assert!(!is_parked("toolu_dead_turn"));
    }

    #[tokio::test]
    async fn an_answer_for_a_live_turn_is_delivered() {
        let rx = park_for_test("toolu_live_turn", "live-turn-session");

        assert!(resolve_live("toolu_live_turn", answered(), |session| {
            session == "live-turn-session"
        }));

        assert!(matches!(rx.await.unwrap(), DialogOutcome::Answered { .. }));
        assert!(!is_parked("toolu_live_turn"));
    }

    #[test]
    fn resolve_live_reports_false_when_nothing_is_parked() {
        assert!(!resolve_live("toolu_never_parked_live", answered(), |_| {
            true
        }));
    }
}
