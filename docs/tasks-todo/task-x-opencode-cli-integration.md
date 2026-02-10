# OpenCode CLI Integration

## Overview

Add OpenCode CLI as an alternative provider alongside existing Claude CLI. Uses parallel module approach (not provider trait abstraction) to minimize risk to existing functionality.

## CLI Command Reference

```bash
# Basic invocation
opencode run --format json --model "opencode/grok-code" --agent build "message"

# Continue session
opencode run --format json --model "..." --session <id> "message"

# List available models
opencode models
```

## Key Mappings

| Jean Mode | OpenCode Flag   | Claude Flag                           |
| --------- | --------------- | ------------------------------------- |
| plan      | `--agent plan`  | `--permission-mode plan`              |
| build     | `--agent build` | `--permission-mode acceptEdits`       |
| yolo      | `--agent build` | `--permission-mode bypassPermissions` |

| Jean Thinking | OpenCode Variant (Anthropic) |
| ------------- | ---------------------------- |
| Off           | (none)                       |
| Think         | `--variant high`             |
| Megathink     | `--variant high`             |
| Ultrathink    | `--variant max`              |

## OpenCode NDJSON Events → Jean Events

| OpenCode Event             | Jean Event                           | Notes                            |
| -------------------------- | ------------------------------------ | -------------------------------- |
| `step_start`               | (internal)                           | Track step beginning             |
| `text`                     | `chat:chunk`                         | `part.text` → content            |
| `tool_use`                 | `chat:tool_use` + `chat:tool_result` | Split single event               |
| `step_finish` (stop)       | `chat:done`                          | Extract usage from `part.tokens` |
| `step_finish` (tool-calls) | (internal)                           | More steps coming                |

## File Changes

### New Files

1. **`src-tauri/src/chat/opencode.rs`** (~400 lines)
   - `build_opencode_args()` - Build CLI arguments
   - `execute_opencode_detached()` - Spawn detached process
   - `tail_opencode_output()` - Parse NDJSON, emit events
   - `thinking_level_to_variant()` - Map ThinkingLevel to variant

2. **`src-tauri/src/opencode_cli/mod.rs`** + **`config.rs`** + **`commands.rs`**
   - `get_opencode_binary_path()` - Find binary via `which opencode`
   - `check_opencode_installed()` - Verify installation
   - `get_opencode_version()` - Get version string

### Modified Files

3. **`src-tauri/src/chat/types.rs`**
   - Add to `SessionMetadata`:

     ```rust
     #[serde(default = "default_provider")]
     pub provider: String,  // "claude" | "opencode"

     #[serde(default, skip_serializing_if = "Option::is_none")]
     pub opencode_session_id: Option<String>,
     ```

4. **`src-tauri/src/chat/mod.rs`**
   - Add `mod opencode;`

5. **`src-tauri/src/chat/commands.rs`**
   - Add `list_opencode_models` command
   - Modify `send_chat_message` to:
     - Accept `provider: Option<String>` parameter
     - Branch on provider to call `opencode.rs` or `claude.rs`
     - Store `opencode_session_id` when provider is "opencode"

6. **`src-tauri/src/lib.rs`**
   - Register new commands: `list_opencode_models`, `check_opencode_installed`
   - Add `mod opencode_cli;`

7. **`src/types/chat.ts`**
   - Add to `Session` interface:
     ```typescript
     provider?: 'claude' | 'opencode'
     opencode_session_id?: string
     ```

8. **`src/store/chat-store.ts`**
   - Add `selectedProviders: Record<string, 'claude' | 'opencode'>`
   - Add `setProvider(sessionId, provider)` action

9. **`src/components/chat/ChatToolbar.tsx`**
   - Add provider toggle (Claude CLI / OpenCode dropdown)
   - Make model selector dynamic based on provider
   - Fetch OpenCode models when provider = "opencode"

10. **`src/components/chat/ChatWindow.tsx`**
    - Pass `provider` to `send_chat_message` invoke

## Implementation Order

### Phase 1: Backend Core

1. Create `src-tauri/src/opencode_cli/` module with path detection
2. Add types to `types.rs` (provider, opencode_session_id)
3. Create `opencode.rs` with `build_opencode_args()`
4. Add `list_opencode_models` command

### Phase 2: Event Parsing

1. Implement `tail_opencode_output()` with event parsing
2. Handle combined tool_use events (split into tool_use + tool_result)
3. Extract usage from step_finish events

### Phase 3: Integration

1. Modify `send_chat_message` to branch on provider
2. Store `opencode_session_id` in session metadata
3. Handle session resumption with `--session` flag

### Phase 4: Frontend

1. Add TypeScript types for provider
2. Add provider state to Zustand store
3. Add provider toggle to ChatToolbar
4. Make model selector dynamic

## Token Usage Mapping

```rust
// OpenCode format
{"tokens": {"input": 11421, "output": 45, "reasoning": 83, "cache": {"read": 2176, "write": 0}}}

// Map to Jean's UsageData
UsageData {
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_read_input_tokens: tokens.cache.read,
    cache_creation_input_tokens: tokens.cache.write,
}
// Note: reasoning tokens not currently tracked in Jean
```

## Verification

1. **Unit test**: Parse sample OpenCode NDJSON events
2. **Manual test**:
   - Toggle to OpenCode provider
   - Send message with `opencode/grok-code` model
   - Verify streaming text appears
   - Verify tool calls render correctly
   - Verify token usage displayed
3. **Session resumption**:
   - Send message, close app, reopen
   - Send follow-up, verify context preserved
4. **Model discovery**:
   - Verify `opencode models` output populates dropdown

## Decisions

1. **Default provider**: Remember last used (stored in preferences)
2. **Yolo mode**: Hide yolo option when OpenCode is selected (only show plan/build)
3. **Installation management**: Jean manages OpenCode CLI installation (like Claude CLI)

## Additional Files for Installation Management

11. **`src-tauri/src/opencode_cli/commands.rs`**
    - `check_opencode_status` - Check if installed, get version
    - `install_opencode_cli` - Download and install binary
    - `get_opencode_versions` - Fetch available releases from GitHub

12. **`src/services/opencode-cli.ts`**
    - TanStack Query hooks mirroring `claude-cli.ts`:
      - `useOpenCodeStatus()`
      - `useOpenCodeAuth()` (if applicable)
      - `useAvailableOpenCodeVersions()`
      - `useInstallOpenCode()`

13. **`src/types/preferences.ts`**
    - Add `last_used_provider: 'claude' | 'opencode'`

14. **`src/components/chat/ExecutionModeSelector.tsx`** (or toolbar)
    - Conditionally hide yolo option based on provider
