# Restore the Claude dialog tool harness (AskUserQuestion / EnterPlanMode / ExitPlanMode)

Tracked in this fork as [azeitler/jean#1](https://github.com/azeitler/jean/issues/1), imported from
upstream [coollabsio/jean#460](https://github.com/coollabsio/jean/issues/460)
("AskUserQuestion silently degrades to plain-text on Jean-managed Claude CLI ≥ 2.1.187").
Upstream closed it as _not actionable_ — "we cannot complete those host dialogs without a
large architectural rewrite of the Claude backend". **That conclusion rests on a wrong root
cause.** This task carries the work in this fork with the verified root cause.

## Status: root cause verified, fix is a CLI flag + one MCP tool

### What upstream got wrong

The issue (and the close comment) assumed the gate was the SDK host-dialog protocol —
`supportedDialogKinds` + `onUserDialog`, requiring a long-lived bidirectional control
channel over stdin. Verified against the shipped CLI, that is **not** the gate.

Decompiled from the Jean-managed CLI (2.1.231), the `AskUserQuestion` tool's `isEnabled`:

```js
var eh = 'AskUserQuestion'
JBr = Oi({
  name: eh,
  /* … */ isEnabled() {
    return aEt()
  } /* … */,
})

function aEt() {
  if (rP().length > 0 && Rn()) return false // allowedChannels non-empty && non-interactive
  if (Rn() && !Vbe()) return false // non-interactive && no --permission-prompt-tool
  return true
}

function Rn() {
  return !dh.isInteractive()
} // true under --print
function Vbe() {
  return dh.permissionPromptToolName()
} // the --permission-prompt-tool flag
```

So under `--print`, the dialog tools are enabled **iff `--permission-prompt-tool` is set.**
`supportedDialogKinds` is real (print-mode `initialize` does read it, and the CLI does emit
`control_request` / `request_user_dialog`) but it is not what gates the tool.

### Verified empirically (CLI 2.1.231, `--print --output-format stream-json --input-format stream-json`)

| Run                                                      | `--permission-prompt-tool` | `AskUserQuestion` in `system/init` tools  |
| -------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| baseline                                                 | absent                     | **no**                                    |
| `initialize` control_request with `supportedDialogKinds` | absent                     | **no** (ack'd `success`, tool still gone) |
| dummy flag value, no MCP server                          | present                    | **yes**                                   |
| real stdio MCP server                                    | present                    | **yes**                                   |

The flag restores **three** tools, not one: `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`.

Full round-trip proven with a throwaway stdio MCP server: model emits `AskUserQuestion` →
CLI calls `mcp__<server>__permission_prompt` with
`{tool_name: "AskUserQuestion", input: {questions: [...]}, tool_use_id}` → server returns
`{"behavior":"allow","updatedInput":{questions, answers}}` → CLI synthesizes
`"Your questions have been answered: …"` as the tool_result and the turn continues.

**No control channel is involved.** The MCP server is a separate process, so this is fully
compatible with the existing detached `cat input.jsonl | nohup claude >> output.jsonl`
model in `jean-core/src/chat/detached.rs`. The rewrite upstream declined is not required.

## Why this fork can ship it cheaply

Jean already owns every piece:

- `jean-core/src/jean_mcp_socket.rs` — Jean-owned local IPC MCP server
- `jean-core/src/jean_mcp_stdio.rs` — stdio shim the CLI spawns (`--jean-mcp-stdio`), proxying to the socket
- `jean-core/src/chat/jean_mcp.rs` — builds/merges the `mcpServers.jean` entry; already passes `JEAN_MCP_SESSION_ENV`
- `src/components/chat/AskUserQuestion.tsx` — renderer already supports the tool
- `getAskUserQuestions` / `isAskUserQuestion` in `src/types/chat.ts` — parsing already in place
- Codex's `pending_requests` round-trip in `jean-core/src/chat/codex_server.rs` — an existing
  pattern for "route an inbound agent request to the UI and block on the answer"
- `plan_mode_permission_allowed` in `jean-core/src/chat/grok.rs` — existing plan-mode allow/deny policy to reuse

## Implementation sketch

1. **New MCP tool** `permission_prompt` in `jean-core/src/jean_mcp_core.rs`.
   Input: `{tool_name, input, tool_use_id}`. Output: single text block containing
   `{"behavior":"allow","updatedInput":{…}}` or `{"behavior":"deny","message":"…"}`.
   - `AskUserQuestion` → emit a Jean event carrying `questions` + `tool_use_id`, register a
     pending request keyed by `tool_use_id`, block until the UI answers, return
     `updatedInput: {questions, answers}` (answers is `question text -> label`;
     multi-select answers comma-separated).
   - `ExitPlanMode` / `EnterPlanMode` → route into the existing plan-approval UI.
   - Everything else → preserve today's behavior exactly (see risk 2).
2. **Pass the flag** in `build_claude_args` (`jean-core/src/chat/claude.rs:456`):
   `--permission-prompt-tool mcp__{server_name}__permission_prompt`, where `server_name` is
   `jean_mcp_config::current_mode().server_name()` (`jean` in release, `jean-dev` in debug).
3. **Answer path**: reuse the existing answered-tool-call plumbing
   (`answered_tool_call_ids` in `src/types/chat.ts` / `types.rs`) plus a new
   `answer_claude_dialog` command; register it in **both** `src-tauri/src/lib.rs`
   `generate_handler![]` and `jean-core/src/http_server/dispatch.rs`.
4. **Remove the workarounds** once green: the tool-error suppression in
   `jean-core/src/chat/run_log.rs:999-1060` and `commands.rs:10412`, and the
   "if AskUserQuestion is not in your tool set, ask inline with a numbered list" hedging in
   the system prompts (`claude.rs:31`, `claude.rs:113-122`, `lib.rs:2100`,
   `src/types/preferences.ts:654`).

## Prerequisites — all verified against CLI 2.1.231

Full results: [azeitler/jean#1 (comment)](https://github.com/azeitler/jean/issues/1#issuecomment-5286718708)

**Cleared**

- All four permission modes (`plan`/`default`/`acceptEdits`/`bypassPermissions`) expose all three tools, n_tools=33 each. Round-trip re-verified under `bypassPermissions` — dialog tools are exempt from bypass.
- `allowedChannels` (`rP()`, the other half of the gate) is set only by `--channels`, `--dangerously-load-development-channels`, or the `channel_enable` control request. Jean passes none.
- `commands.rs:3427` already merges the Jean MCP entry into Claude's runtime `--mcp-config` on every turn; `append_mcp_config_args` auto-allows `mcp__{server}__*`; `jean_mcp_enabled` defaults true.
- MCP call errors/timeouts are **soft**: `tool_use_error` tool*result, turn continues, `exit=0`. Only a \_missing* tool is fatal (`exit=1`).

**Risk 2 downgraded** — measured `permission_prompt` traffic for a Bash+Write+Read sequence:
`acceptEdits` (build) → **none**; `bypassPermissions` (yolo) → **none**; `plan` → `ExitPlanMode`, then Bash/Write only after in-process approval. Default-arm policy is needed for plan mode only.

**New blockers (all in the MCP shim)**

1. **Idle abort — hardening, not a blocker.** Default stdio idle timeout is `kLS = 1800000` ms = **30 minutes**, not 30s (an earlier 30s reading was an artifact of setting `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=3000`, which clamps up to a 30s floor). Verified: 60s park with the pinger disabled completes normally. Progress notifications reset the idle timer, so ping every ~10s to survive parks beyond 30 min — worth doing, but the feature works without it.
2. **`_meta` is dropped.** CLI sends `params._meta.progressToken`; `ToolCallRequest` (`jean_mcp_core.rs:99`) carries only `{name, arguments}`. Must be threaded through shim + socket protocol, or blocker 1 is unsatisfiable.
3. **Shim is write-only-on-return.** `run_stdio_server` (`jean_mcp_stdio.rs:23`) is a blocking loop that writes only `handle_message`'s return value, so it cannot interleave progress notifications. A stdout write mutex is required. Per-request dispatch is optional: the rig showed the **CLI serializes tool calls within an assistant message**, so a parked dialog blocks the rest of that message regardless of shim threading.
4. **120s socket read timeout** (`jean_mcp_stdio.rs:81`) kills a parked question at 2 min. Raise or make per-tool.
5. **Hard cap** is the per-server `timeout` (`EMa()`): default `1e8` ms ≈ 27.8h, cap `2147483647` ms. Progress does **not** extend it — verified `"timeout": 5000` + pings still died at 5s. Set an explicit bound in `build_jean_mcp_entry`.

**Remaining risk 1 (fatal if wrong):** only pass `--permission-prompt-tool` when `merge_into_mcp_config` actually yields the jean server; otherwise the run dies with `exit=1`.

**Design decision 3 resolved:** ping every ~10s on the progress token; bound parking with an explicit per-server `timeout`; on Jean shutdown pings stop, the CLI aborts that dialog after 30s with a soft `tool_use_error`, and the run survives. No persist-and-reattach needed for v1.

## Pre-implementation acceptance rig

`scripts/claude-dialog-rig/` reproduces Jean's topology in Python (stdio shim -> unix socket -> app process holding a human) against the real CLI and real model, so the design is validated before any Rust is written. `DEGRADE=b1|b2|b3|b4` disables each fix to confirm the rig detects its absence.

```
./scripts/claude-dialog-rig/run.sh 40 none   # human answers after 40s
RESULT: PASS
```

Also serves as a CLI contract test: the feature rests on undocumented internals, so a Claude CLI upgrade that moves the gate fails loudly instead of silently degrading to plain text (how #460 started). Depends on Jean's existing `--allowedTools mcp__{server}__*` auto-allow — without it, Jean's own MCP tools route through the permission arm.

## Repro / verification

Baseline (tool absent):

```
cat in.jsonl | claude --print --output-format stream-json --input-format stream-json \
  --verbose --tools default --permission-mode plan --model haiku
```

With the harness restored (tool present, round-trip works):

```
cat in.jsonl | claude --print --output-format stream-json --input-format stream-json \
  --verbose --tools default --permission-mode plan --model haiku \
  --permission-prompt-tool mcp__jeanperm__permission_prompt \
  --mcp-config ./mcp.json --strict-mcp-config
```

Check `AskUserQuestion` in the `system/init` message's `tools` array.

## Notes

- The `auto_update_ai_backends` / `versions.truncate(5)` pin-list stopgap from the original
  issue is now moot — no version pinning is needed once the flag is passed.
- Upstream's `supportedDialogKinds` path is still worth knowing: the print-mode `initialize`
  handler does read it and `request_user_dialog` control*requests are real. That would be the
  route to \_host-side* dialog rendering; it is not needed to re-enable the tools.
