//! Codex CLI execution engine
//!
//! Mirrors the Claude CLI execution pattern (claude.rs) but adapted for
//! OpenAI's Codex CLI. Key differences:
//! - Codex uses `exec --json` instead of `--print --output-format stream-json`
//! - Prompt is passed as a positional argument, not piped via stdin
//! - Resume uses `resume <thread_id>` positional args
//! - Different JSONL event format (item.started/completed vs assistant/user/result)
//! - No thinking/effort levels, no --settings, no --add-dir, no MCP config

use super::types::{ContentBlock, ToolCall, UsageData};
use crate::http_server::EmitExt;

// =============================================================================
// Response type (same shape as ClaudeResponse)
// =============================================================================

/// Response from Codex CLI execution
pub struct CodexResponse {
    /// The text response content
    pub content: String,
    /// The thread ID (for resuming conversations)
    pub thread_id: String,
    /// Tool calls made during this response
    pub tool_calls: Vec<ToolCall>,
    /// Ordered content blocks preserving tool position in response
    pub content_blocks: Vec<ContentBlock>,
    /// Whether the response was cancelled by the user
    pub cancelled: bool,
    /// Token usage for this response
    pub usage: Option<UsageData>,
}

// =============================================================================
// Event structs (reuse same Tauri event names as Claude for frontend compat)
// =============================================================================

#[derive(serde::Serialize, Clone)]
struct ChunkEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct ToolUseEvent {
    session_id: String,
    worktree_id: String,
    id: String,
    name: String,
    input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct ToolResultEvent {
    session_id: String,
    worktree_id: String,
    tool_use_id: String,
    output: String,
}

#[derive(serde::Serialize, Clone)]
struct ToolBlockEvent {
    session_id: String,
    worktree_id: String,
    tool_call_id: String,
}

#[derive(serde::Serialize, Clone)]
struct ThinkingEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct DoneEvent {
    session_id: String,
    worktree_id: String,
}

#[derive(serde::Serialize, Clone)]
struct ErrorEvent {
    session_id: String,
    worktree_id: String,
    error: String,
}

// =============================================================================
// Arg builder
// =============================================================================

/// Build CLI arguments for Codex CLI.
///
/// Returns (args, env_vars).
pub fn build_codex_args(
    working_dir: &std::path::Path,
    existing_thread_id: Option<&str>,
    model: Option<&str>,
    execution_mode: Option<&str>,
    reasoning_effort: Option<&str>,
    search_enabled: bool,
    add_dirs: &[String],
) -> (Vec<String>, Vec<(String, String)>) {
    let mut args = Vec::new();
    let env_vars = Vec::new();

    // Core command
    args.push("exec".to_string());
    args.push("--json".to_string());

    // Working directory
    args.push("--cd".to_string());
    args.push(working_dir.to_string_lossy().to_string());

    // Model
    if let Some(m) = model {
        args.push("--model".to_string());
        args.push(m.to_string());
    }

    // Permission mode mapping
    match execution_mode.unwrap_or("plan") {
        "build" => {
            args.push("--full-auto".to_string());
        }
        "yolo" => {
            args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        }
        // "plan" or default: no flag needed (read-only sandbox is default)
        _ => {}
    }

    // Reasoning effort
    if let Some(effort) = reasoning_effort {
        args.push("-c".to_string());
        args.push(format!("model_reasoning_effort=\"{effort}\""));
    }

    // Web search: use -c config override (--search is interactive-only)
    // Values: "live" (real-time), "cached" (default), "disabled"
    args.push("-c".to_string());
    if search_enabled {
        args.push("web_search=\"live\"".to_string());
    } else {
        args.push("web_search=\"disabled\"".to_string());
    }

    // Additional directories (pasted images, context files, etc.)
    for dir in add_dirs {
        args.push("--add-dir".to_string());
        args.push(dir.clone());
    }

    // Resume: positional args after all flags
    if let Some(thread_id) = existing_thread_id {
        args.push("resume".to_string());
        args.push(thread_id.to_string());
    }

    (args, env_vars)
}

// =============================================================================
// Detached execution
// =============================================================================

/// Execute Codex CLI in detached mode.
///
/// Spawns the process, tails the output file for real-time events,
/// and returns the response when complete.
#[allow(clippy::too_many_arguments)]
pub fn execute_codex_detached(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    output_file: &std::path::Path,
    working_dir: &std::path::Path,
    existing_thread_id: Option<&str>,
    model: Option<&str>,
    execution_mode: Option<&str>,
    reasoning_effort: Option<&str>,
    search_enabled: bool,
    add_dirs: &[String],
    prompt: Option<&str>,
) -> Result<(u32, CodexResponse), String> {
    use super::detached::spawn_detached_codex;
    use crate::codex_cli::resolve_cli_binary;

    log::trace!("Executing Codex CLI (detached) for session: {session_id}");

    let cli_path = resolve_cli_binary(app);

    if !cli_path.exists() {
        let error_msg = format!(
            "Codex CLI not found at {}. Please install it in Settings > General.",
            cli_path.display()
        );
        log::error!("{error_msg}");
        let _ = app.emit_all(
            "chat:error",
            &ErrorEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                error: error_msg.clone(),
            },
        );
        return Err(error_msg);
    }

    // Build args
    let (args, env_vars) = build_codex_args(
        working_dir,
        existing_thread_id,
        model,
        execution_mode,
        reasoning_effort,
        search_enabled,
        add_dirs,
    );

    log::debug!(
        "Codex CLI command: {} {}",
        cli_path.display(),
        args.join(" ")
    );

    let env_refs: Vec<(&str, &str)> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    // Spawn detached process
    let pid = spawn_detached_codex(
        &cli_path,
        &args,
        prompt,
        output_file,
        working_dir,
        &env_refs,
    )
    .map_err(|e| {
        let error_msg = format!("Failed to start Codex CLI: {e}");
        log::error!("{error_msg}");
        let _ = app.emit_all(
            "chat:error",
            &ErrorEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                error: error_msg.clone(),
            },
        );
        error_msg
    })?;

    log::trace!("Detached Codex CLI spawned with PID: {pid}");

    // Register the process for cancellation
    super::registry::register_process(session_id.to_string(), pid);

    // Tail the output file for real-time updates
    super::increment_tailer_count();
    let response = match tail_codex_output(app, session_id, worktree_id, output_file, pid) {
        Ok(resp) => {
            super::decrement_tailer_count();
            super::registry::unregister_process(session_id);
            resp
        }
        Err(e) => {
            super::decrement_tailer_count();
            super::registry::unregister_process(session_id);
            return Err(e);
        }
    };

    Ok((pid, response))
}

// =============================================================================
// File-based tailing for detached Codex CLI
// =============================================================================

/// Tail a Codex JSONL output file and emit events as new lines appear.
///
/// Maps Codex events to the same Tauri events used by Claude, so the
/// frontend streaming infrastructure works unchanged.
pub fn tail_codex_output(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    output_file: &std::path::Path,
    pid: u32,
) -> Result<CodexResponse, String> {
    use super::detached::is_process_alive;
    use super::tail::{NdjsonTailer, POLL_INTERVAL};
    use std::time::{Duration, Instant};

    log::trace!("Starting to tail Codex NDJSON output for session: {session_id}");

    let mut tailer = NdjsonTailer::new_from_start(output_file)?;

    let mut full_content = String::new();
    let mut thread_id = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();
    let mut completed = false;
    let mut cancelled = false;
    let mut usage: Option<UsageData> = None;
    let mut error_lines: Vec<String> = Vec::new();

    // Track tool IDs for matching started/completed pairs
    let mut pending_tool_ids: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    let startup_timeout = Duration::from_secs(120);
    let dead_process_timeout = Duration::from_secs(2);
    let started_at = Instant::now();
    let mut last_output_time = Instant::now();
    let mut received_codex_output = false;

    loop {
        let lines = tailer.poll()?;

        if !lines.is_empty() {
            last_output_time = Instant::now();
        }

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            // Skip our metadata header
            if line.contains("\"_run_meta\"") {
                continue;
            }

            if !received_codex_output {
                log::trace!("Received first Codex output for session: {session_id}");
                received_codex_output = true;
            }

            let msg: serde_json::Value = match serde_json::from_str(&line) {
                Ok(m) => m,
                Err(e) => {
                    log::trace!("Failed to parse Codex line as JSON: {e}");
                    let trimmed = line.trim().to_string();
                    if !trimmed.is_empty() {
                        error_lines.push(trimmed);
                    }
                    continue;
                }
            };

            let event_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match event_type {
                // Thread started — capture thread_id for session resume
                "thread.started" => {
                    if let Some(tid) = msg.get("thread_id").and_then(|v| v.as_str()) {
                        thread_id = tid.to_string();
                        log::trace!("Codex thread started: {thread_id}");
                    }
                }

                // Item started — emit tool_use for command_execution and file_change
                "item.started" => {
                    let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                    match item_type {
                        "command_execution" => {
                            let command =
                                item.get("command").and_then(|v| v.as_str()).unwrap_or("");
                            let tool_id = if item_id.is_empty() {
                                uuid::Uuid::new_v4().to_string()
                            } else {
                                item_id.to_string()
                            };

                            tool_calls.push(ToolCall {
                                id: tool_id.clone(),
                                name: "Bash".to_string(),
                                input: serde_json::json!({ "command": command }),
                                output: None,
                                parent_tool_use_id: None,
                            });
                            content_blocks.push(ContentBlock::ToolUse {
                                tool_call_id: tool_id.clone(),
                            });

                            // Track for matching completed event
                            if !item_id.is_empty() {
                                pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                            }

                            let _ = app.emit_all(
                                "chat:tool_use",
                                &ToolUseEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    id: tool_id.clone(),
                                    name: "Bash".to_string(),
                                    input: serde_json::json!({ "command": command }),
                                    parent_tool_use_id: None,
                                },
                            );
                            let _ = app.emit_all(
                                "chat:tool_block",
                                &ToolBlockEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    tool_call_id: tool_id,
                                },
                            );
                        }
                        "file_change" => {
                            let tool_id = if item_id.is_empty() {
                                uuid::Uuid::new_v4().to_string()
                            } else {
                                item_id.to_string()
                            };
                            let changes = item
                                .get("changes")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);

                            tool_calls.push(ToolCall {
                                id: tool_id.clone(),
                                name: "FileChange".to_string(),
                                input: changes.clone(),
                                output: None,
                                parent_tool_use_id: None,
                            });
                            content_blocks.push(ContentBlock::ToolUse {
                                tool_call_id: tool_id.clone(),
                            });

                            if !item_id.is_empty() {
                                pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                            }

                            let _ = app.emit_all(
                                "chat:tool_use",
                                &ToolUseEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    id: tool_id.clone(),
                                    name: "FileChange".to_string(),
                                    input: changes,
                                    parent_tool_use_id: None,
                                },
                            );
                            let _ = app.emit_all(
                                "chat:tool_block",
                                &ToolBlockEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    tool_call_id: tool_id,
                                },
                            );
                        }
                        "mcp_tool_call" => {
                            let server = item
                                .get("server")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let tool = item
                                .get("tool")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let arguments = item
                                .get("arguments")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);
                            let tool_id = if item_id.is_empty() {
                                uuid::Uuid::new_v4().to_string()
                            } else {
                                item_id.to_string()
                            };
                            let name = format!("mcp:{server}:{tool}");

                            tool_calls.push(ToolCall {
                                id: tool_id.clone(),
                                name: name.clone(),
                                input: arguments.clone(),
                                output: None,
                                parent_tool_use_id: None,
                            });
                            content_blocks.push(ContentBlock::ToolUse {
                                tool_call_id: tool_id.clone(),
                            });

                            if !item_id.is_empty() {
                                pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                            }

                            let _ = app.emit_all(
                                "chat:tool_use",
                                &ToolUseEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    id: tool_id.clone(),
                                    name,
                                    input: arguments,
                                    parent_tool_use_id: None,
                                },
                            );
                            let _ = app.emit_all(
                                "chat:tool_block",
                                &ToolBlockEvent {
                                    session_id: session_id.to_string(),
                                    worktree_id: worktree_id.to_string(),
                                    tool_call_id: tool_id,
                                },
                            );
                        }
                        _ => {}
                    }
                }

                // Item completed — emit content or tool results
                "item.completed" => {
                    let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                    match item_type {
                        "agent_message" => {
                            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    full_content.push_str(text);
                                    content_blocks.push(ContentBlock::Text {
                                        text: text.to_string(),
                                    });

                                    let _ = app.emit_all(
                                        "chat:chunk",
                                        &ChunkEvent {
                                            session_id: session_id.to_string(),
                                            worktree_id: worktree_id.to_string(),
                                            content: text.to_string(),
                                        },
                                    );
                                }
                            }
                        }
                        "command_execution" => {
                            let output = item
                                .get("aggregated_output")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();

                            // Find matching tool call and update output
                            let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                            if !tool_id.is_empty() {
                                if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                    tc.output = Some(output.clone());
                                }
                                let _ = app.emit_all(
                                    "chat:tool_result",
                                    &ToolResultEvent {
                                        session_id: session_id.to_string(),
                                        worktree_id: worktree_id.to_string(),
                                        tool_use_id: tool_id,
                                        output,
                                    },
                                );
                            }
                        }
                        "file_change" => {
                            let changes = item
                                .get("changes")
                                .map(|v| serde_json::to_string(v).unwrap_or_default())
                                .unwrap_or_default();

                            let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                            if !tool_id.is_empty() {
                                if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                    tc.output = Some(changes.clone());
                                }
                                let _ = app.emit_all(
                                    "chat:tool_result",
                                    &ToolResultEvent {
                                        session_id: session_id.to_string(),
                                        worktree_id: worktree_id.to_string(),
                                        tool_use_id: tool_id,
                                        output: changes,
                                    },
                                );
                            }
                        }
                        "reasoning" => {
                            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                content_blocks.push(ContentBlock::Thinking {
                                    thinking: text.to_string(),
                                });
                                let _ = app.emit_all(
                                    "chat:thinking",
                                    &ThinkingEvent {
                                        session_id: session_id.to_string(),
                                        worktree_id: worktree_id.to_string(),
                                        content: text.to_string(),
                                    },
                                );
                            }
                        }
                        "mcp_tool_call" => {
                            let output = item
                                .get("output")
                                .map(|v| {
                                    if let Some(s) = v.as_str() {
                                        s.to_string()
                                    } else {
                                        serde_json::to_string(v).unwrap_or_default()
                                    }
                                })
                                .unwrap_or_default();

                            let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                            if !tool_id.is_empty() {
                                if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                    tc.output = Some(output.clone());
                                }
                                let _ = app.emit_all(
                                    "chat:tool_result",
                                    &ToolResultEvent {
                                        session_id: session_id.to_string(),
                                        worktree_id: worktree_id.to_string(),
                                        tool_use_id: tool_id,
                                        output,
                                    },
                                );
                            }
                        }
                        _ => {}
                    }
                }

                // Turn completed — extract usage data
                "turn.completed" => {
                    if let Some(usage_obj) = msg.get("usage") {
                        usage = Some(UsageData {
                            input_tokens: usage_obj
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            output_tokens: usage_obj
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            // Codex uses cached_input_tokens → map to cache_read_input_tokens
                            cache_read_input_tokens: usage_obj
                                .get("cached_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            cache_creation_input_tokens: 0,
                        });
                    }
                    completed = true;
                    log::trace!("Codex turn completed for session: {session_id}");
                }

                // Turn failed — emit error
                "turn.failed" => {
                    let error_msg = msg
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown Codex error");

                    let user_error = if error_msg.contains("refresh_token_invalidated")
                        || error_msg.contains("refresh token has been invalidated")
                    {
                        "Your Codex login session has expired. Please sign in again in Settings > General.".to_string()
                    } else if error_msg.contains("401 Unauthorized")
                        || error_msg.contains("invalidated oauth token")
                    {
                        "Codex authentication failed. Please sign in again in Settings > General."
                            .to_string()
                    } else {
                        error_msg.to_string()
                    };

                    let _ = app.emit_all(
                        "chat:error",
                        &ErrorEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            error: user_error,
                        },
                    );

                    completed = true;
                    log::error!("Codex turn failed for session {session_id}: {error_msg}");
                }

                _ => {
                    log::trace!("Unknown Codex event type: {event_type}");
                }
            }
        }

        if completed {
            break;
        }

        // Check if externally cancelled
        if !super::registry::is_process_running(session_id) {
            log::trace!("Session {session_id} cancelled externally, stopping Codex tail");
            cancelled = true;
            break;
        }

        // Timeout logic
        let process_alive = is_process_alive(pid);

        if received_codex_output {
            if !process_alive && last_output_time.elapsed() > dead_process_timeout {
                log::trace!("Codex process {pid} is no longer running and no new output");
                cancelled = true;
                break;
            }
        } else {
            let elapsed = started_at.elapsed();

            if !process_alive && elapsed > Duration::from_secs(5) {
                log::warn!(
                    "Codex process {pid} died during startup after {:.1}s with no output",
                    elapsed.as_secs_f64()
                );
                cancelled = true;
                break;
            }

            if elapsed > startup_timeout {
                log::warn!("Startup timeout exceeded waiting for Codex output");
                cancelled = true;
                break;
            }
        }

        std::thread::sleep(POLL_INTERVAL);
    }

    // Surface errors
    if cancelled || (full_content.is_empty() && !received_codex_output) {
        if let Ok(remaining) = tailer.poll() {
            for line in remaining {
                let trimmed = line.trim();
                if !trimmed.is_empty()
                    && !trimmed.contains("\"_run_meta\"")
                    && serde_json::from_str::<serde_json::Value>(trimmed).is_err()
                {
                    error_lines.push(trimmed.to_string());
                }
            }
        }
        let drained = tailer.drain_buffer();
        if !drained.trim().is_empty() {
            error_lines.push(drained.trim().to_string());
        }
    }

    if !error_lines.is_empty() && full_content.is_empty() {
        let error_text = error_lines.join("\n");
        log::warn!("Codex CLI error output for session {session_id}: {error_text}");

        let user_error = if error_text.contains("refresh_token_invalidated")
            || error_text.contains("refresh token has been invalidated")
        {
            "Your Codex login session has expired. Please sign in again in Settings > General."
                .to_string()
        } else if error_text.contains("401 Unauthorized")
            || error_text.contains("invalidated oauth token")
        {
            "Codex authentication failed. Please sign in again in Settings > General.".to_string()
        } else {
            format!("Codex CLI failed: {error_text}")
        };

        let _ = app.emit_all(
            "chat:error",
            &ErrorEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                error: user_error,
            },
        );
    }

    // Emit done event only if not cancelled
    if !cancelled {
        let _ = app.emit_all(
            "chat:done",
            &DoneEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
            },
        );
    }

    log::trace!(
        "Codex tailing complete: {} chars, {} tool calls, cancelled: {cancelled}",
        full_content.len(),
        tool_calls.len()
    );

    Ok(CodexResponse {
        content: full_content,
        thread_id,
        tool_calls,
        content_blocks,
        cancelled,
        usage,
    })
}

// =============================================================================
// JSONL history parser (for loading saved sessions)
// =============================================================================

/// Parse stored Codex JSONL into a ChatMessage (for loading history).
///
/// Maps Codex events to the same ChatMessage format used by Claude sessions.
pub fn parse_codex_run_to_message(
    lines: &[String],
    run: &super::types::RunEntry,
) -> Result<super::types::ChatMessage, String> {
    use super::types::{ChatMessage, MessageRole};
    use uuid::Uuid;

    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();
    let mut pending_tool_ids: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let msg: serde_json::Value = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        if msg
            .get("_run_meta")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }

        let event_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "item.started" => {
                let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match item_type {
                    "command_execution" => {
                        let command = item.get("command").and_then(|v| v.as_str()).unwrap_or("");
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: "Bash".to_string(),
                            input: serde_json::json!({ "command": command }),
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    "file_change" => {
                        let changes = item
                            .get("changes")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: "FileChange".to_string(),
                            input: changes,
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    "mcp_tool_call" => {
                        let server = item
                            .get("server")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let tool = item
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let arguments = item
                            .get("arguments")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: format!("mcp:{server}:{tool}"),
                            input: arguments,
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    _ => {}
                }
            }
            "item.completed" => {
                let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match item_type {
                    "agent_message" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            content.push_str(text);
                            content_blocks.push(ContentBlock::Text {
                                text: text.to_string(),
                            });
                        }
                    }
                    "command_execution" => {
                        let output = item
                            .get("aggregated_output")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(output);
                            }
                        }
                    }
                    "file_change" => {
                        let changes = item
                            .get("changes")
                            .map(|v| serde_json::to_string(v).unwrap_or_default())
                            .unwrap_or_default();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(changes);
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            content_blocks.push(ContentBlock::Thinking {
                                thinking: text.to_string(),
                            });
                        }
                    }
                    "mcp_tool_call" => {
                        let output = item
                            .get("output")
                            .map(|v| {
                                if let Some(s) = v.as_str() {
                                    s.to_string()
                                } else {
                                    serde_json::to_string(v).unwrap_or_default()
                                }
                            })
                            .unwrap_or_default();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(output);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    Ok(ChatMessage {
        id: run
            .assistant_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        session_id: String::new(), // Set by caller
        role: MessageRole::Assistant,
        content,
        timestamp: run.started_at,
        tool_calls,
        content_blocks,
        cancelled: run.cancelled,
        plan_approved: false,
        model: None,
        execution_mode: None,
        thinking_level: None,
        effort_level: None,
        recovered: run.recovered,
        usage: run.usage.clone(),
    })
}
