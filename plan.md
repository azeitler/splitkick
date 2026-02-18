# Codex CLI Backend Implementation Plan

## Overview

Add Codex CLI as alternative chat backend. Sessions choose backend before first message; backend is immutable after. Builds on existing Codex CLI install/auth/settings code.

---

## Phase 1: Backend Enum & Data Model (Rust + TS types)

### 1a. `Backend` enum — `src-tauri/src/chat/types.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Backend { #[default] Claude, Codex }
```

### 1b. Add fields to `Session` struct

- `#[serde(default)] pub backend: Backend`
- `#[serde(default)] pub codex_thread_id: Option<String>`

### 1c. Add same fields to `SessionMetadata` struct (NOT RunEntry — backend is immutable per session)

### 1d. Update `to_session()`, `update_from_session()` to carry `backend` + `codex_thread_id`

### 1e. `Session::new()` — add `backend` param, default `Backend::Claude`

### 1f. TypeScript — `src/types/chat.ts`

- `export type Backend = 'claude' | 'codex'`
- Add `backend?: Backend` and `codex_thread_id?: string` to `Session` interface

---

## Phase 2: Codex CLI Execution Engine (new file)

### 2a. New file: `src-tauri/src/chat/codex.rs`

**`build_codex_args()`** — much simpler than Claude:

- `exec --json`
- `--cd <working_dir>`
- `--model <model>` (if set)
- Permission: `plan` → no flag (read-only sandbox default), `build` → `--full-auto`, `yolo` → `--dangerously-bypass-approvals-and-sandbox`
- Resume: `resume <thread_id>` as positional args
- No thinking/effort, no --print, no --input-format, no --settings, no --add-dir, no MCP

**`execute_codex_detached()`** — mirrors `execute_claude_detached()`:

- Resolve binary via `codex_cli::resolve_cli_binary()`
- Build args
- Write run metadata header
- Call `spawn_detached_codex()`
- Tail output with `tail_codex_output()`
- Returns `(pid, CodexResponse)` — same shape as `ClaudeResponse`

**`tail_codex_output()`** — parse Codex JSONL events, emit same Tauri events:
| Codex Event | Tauri Event | Mapping |
|---|---|---|
| `thread.started` | (internal) | Capture `thread_id` |
| `item.completed` type=`agent_message` | `chat:chunk` | `item.text` → content |
| `item.started` type=`command_execution` | `chat:tool_use` | name="Bash" |
| `item.completed` type=`command_execution` | `chat:tool_result` | `aggregated_output` |
| `item.started` type=`file_change` | `chat:tool_use` | name="FileChange" |
| `item.completed` type=`file_change` | `chat:tool_result` | changes |
| `item.completed` type=`reasoning` | `chat:thinking` | thinking content |
| `item.started/completed` type=`mcp_tool_call` | `chat:tool_use`/`chat:tool_result` | server:tool |
| `turn.completed` | (internal) | Extract usage |
| `turn.failed` | `chat:error` | error |

### 2b. Register module — `src-tauri/src/chat/mod.rs`

Add `pub(crate) mod codex;`

---

## Phase 3: Detached Process Spawning

### 3a. `spawn_detached_codex()` — `src-tauri/src/chat/detached.rs`

Key difference from Claude: Codex takes prompt as positional arg, no stdin pipe.

Unix:

```
nohup /path/to/codex exec --json [flags] 'prompt' >> output.jsonl 2>&1 & echo $!
```

Resume:

```
nohup /path/to/codex exec --json resume THREAD_ID >> output.jsonl 2>&1 & echo $!
```

Windows: Direct spawn with `Stdio::null()` stdin, prompt as arg.

---

## Phase 4: JSONL History Parser

### 4a. `parse_codex_run_to_message()` — `src-tauri/src/chat/run_log.rs`

Parse stored JSONL into `ChatMessage` for loading history:

- `item.completed` type=`agent_message` → text + `ContentBlock::Text`
- `item.completed` type=`command_execution` → `ToolCall` name="Bash"
- `item.completed` type=`file_change` → `ToolCall` name="FileChange"
- `item.completed` type=`reasoning` → `ContentBlock::Thinking`
- `item.completed` type=`mcp_tool_call` → `ToolCall` name=`"mcp:{server}:{tool}"`

---

## Phase 5: Backend Routing in Commands

### 5a. `send_chat_message` — `src-tauri/src/chat/commands.rs`

- Add `backend: Option<String>` parameter
- After run log setup, branch: `Backend::Claude` → existing flow (untouched), `Backend::Codex` → call `execute_codex_detached()`
- Store `codex_thread_id` instead of `claude_session_id` on completion
- Parse backend from session if not provided

### 5b. `create_session` — add `backend: Option<String>` param, pass to `Session::new()`

### 5c. `clear_session_history` — also clear `codex_thread_id`

### 5d. `load_session_messages` routing — `src-tauri/src/chat/run_log.rs`

Check `metadata.backend` → `parse_codex_run_to_message()` or `parse_run_to_message()`

### 5e. `resume_session` routing — `src-tauri/src/chat/commands.rs`

Check run backend → call `tail_codex_output()` or `tail_claude_output()`

---

## Phase 6: Frontend — Backend Selection UI

### 6a. Zustand store — `src/store/chat-store.ts`

- Add `Backend` type (`'claude' | 'codex'`)
- Add `selectedBackends: Record<string, Backend>` to store
- Add `setSelectedBackend(sessionId: string, backend: Backend)` action

### 6b. Backend selector — `src/components/chat/ChatToolbar.tsx`

- Small two-button toggle (Claude / Codex) in toolbar area
- Only visible when `session.message_count === 0` (before first message)
- Locked/hidden after first message sent
- Sets backend on store + will pass to `create_session`/`send_chat_message`

### 6c. Model selector adaptation — `src/components/chat/ChatToolbar.tsx`

When backend is `codex`:

- Fixed model list: `gpt-5.3-codex` (default), `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1-codex-mini`
- Hide thinking level / effort level selectors
  When backend is `claude`: unchanged

### 6d. Send message integration — `src/services/chat.ts`

Pass `backend: session.backend ?? selectedBackend ?? 'claude'` to `invoke('send_chat_message', ...)`

### 6e. Create session integration — `src/services/chat.ts`

Pass `backend` to `invoke('create_session', ...)`

---

## Phase 7: Preferences — Default Backend

### 7a. Rust — `src-tauri/src/lib.rs`

Add `#[serde(default)] pub default_backend: Option<String>` to `AppPreferences`

### 7b. TypeScript — `src/types/preferences.ts`

Add `default_backend: string | null` to `AppPreferences`, default `null` (= claude)

### 7c. Settings UI — `src/components/preferences/panes/GeneralPane.tsx`

Add "Default Backend" dropdown (Claude / Codex) in General settings, near top

---

## Phase 8: Session Card Badge (low priority)

Show small backend indicator on session cards (e.g., "Cx" badge for Codex sessions)

---

## Files Summary

**New files (2):**

1. `src-tauri/src/chat/codex.rs` — Codex execution engine + arg builder + tailer + parser

**Modified Rust (5):** 2. `src-tauri/src/chat/types.rs` — Backend enum, new fields on Session/SessionMetadata/RunEntry 3. `src-tauri/src/chat/commands.rs` — Backend routing in send/create/clear/resume 4. `src-tauri/src/chat/run_log.rs` — Codex JSONL parser, routing in load_session_messages 5. `src-tauri/src/chat/detached.rs` — `spawn_detached_codex()` 6. `src-tauri/src/chat/mod.rs` — Register codex module 7. `src-tauri/src/lib.rs` — `default_backend` in AppPreferences

**Modified TypeScript (4):** 8. `src/types/chat.ts` — Backend type, Session fields 9. `src/types/preferences.ts` — default_backend 10. `src/store/chat-store.ts` — selectedBackends state 11. `src/components/chat/ChatToolbar.tsx` — Backend selector, model adaptation 12. `src/services/chat.ts` — Pass backend to invoke calls 13. `src/components/preferences/panes/GeneralPane.tsx` — Default backend setting

**Existing (kept as-is, already on branch):**

- `src-tauri/src/codex_cli/` — Binary resolution, install, auth commands
- `src/services/codex-cli.ts` — React Query hooks for CLI management
- `src/types/codex-cli.ts` — CLI status types
- Settings/modal UI for Codex CLI install/login

---

## Decisions Made

- **Codex JSONL format**: Proceed with plan's event mapping, adjust if real output differs
- **Codex models**: `gpt-5.3-codex` (default), `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1-codex-mini`
- **Backend storage**: Session-level only (on `Session` + `SessionMetadata`), not per-run
