# Session Forking

Forking copies a Jean session's history into a new session that the user can continue
from, without touching the source. There are three shapes, all sharing one core in
`jean-core/src/chat/fork.rs`.

| Shape | Command | Working directory | History |
| --- | --- | --- | --- |
| **New worktree** | `fork_session_to_worktree` (`projects/commands.rs`) | a new git worktree at the source HEAD, with the dirty tree copied over | all runs |
| **Same worktree** | `fork_session_in_place` (`chat/fork.rs`) | the source's, shared | all runs |
| **From a message** | `fork_session_in_place` with `fromMessageId` | the source's, shared | truncated |

Entry points: the session context menu (`SessionContextMenuItems.tsx`, both worktree
shapes), the message right-click menu (`message-thread-context-menu.tsx`, "Fork from
here"), the Magic modal (`H` same worktree, `W` new worktree), and the mobile toolbar
menu. All of them go through `useSessionFork()`.

## What gets copied

- `metadata.json` — the whole record, with `runs` replaced by the kept list.
- `{run_id}.jsonl` for each kept run. `{run_id}.input.jsonl` is **not** copied; it is a
  consumed stdin payload that the source deletes after its run.
- Attached saved contexts (`session-context/{session_id}-context-*.md`) and the
  GitHub/Linear/Sentry/advisory references in `git-context/references.json`. These key
  off the session id, so without an explicit copy a fork would silently lose them.
  Both are best effort — the fork has already succeeded when they run.
- Backend, model, thinking/effort level, provider and execution mode, via `Session::clone()`.

## What gets cleared

`clear_session_runtime_state` and `prepare_forked_metadata` drop every backend resume id
(except the one a native fork reuses, below), every pending approval queue,
`queued_messages`, `scheduled_wakeup` and the `last_run_*` fields.

`sanitize_forked_run` strips per-run state that only made sense in the source:

- `checkpoint_id` — points into the **source worktree's** `ai-checkpoints/{worktree_id}.json`.
  A restore from the fork would revert against a snapshot the fork never took.
- `pid` and `codex_turn_id` — describe the source's processes and in-flight turns.
- A `Running` or `Resumable` status becomes `Crashed`. `run_log::start_run` refuses a
  second concurrent `Running` run, so without this the fork's very first send would fail.

## Truncating at a message

`truncate_runs_at_message(runs, message_id)` decides what the fork inherits:

- `None` — every run.
- an **assistant** message id — that run is kept, so the fork ends with that answer.
- a **user** message id — that run and everything after it is dropped, so the fork ends
  just before that prompt and the user can ask something different there.

A message id that matches no run is an error rather than a silent full fork.

## Regaining the backend's context

A fork shows history the backend has no record of. `PendingFork`, stored on
`SessionMetadata.pending_fork`, records how the fork's **first send** closes that gap.
`run_log::complete` clears it in the same atomic write that records the finished run,
so it fires exactly once per turn that actually ran. A cancelled or crashed first turn
keeps it, and the retry forks again — clearing it at the *start* would drop
`--fork-session` while the source's resume id is still on the session, and the next
send would append the fork's turns to the source transcript.

`fork_strategy(backend, truncated)` picks between:

**`Native`** — Claude only, full forks only. The `claude_session_id` is **kept** and the
first turn runs `--resume <id> --fork-session`, which makes the Claude CLI branch its own
transcript into a fresh session id. Jean's existing write-back then records the new id,
so the two sessions can never interleave into one transcript. This costs no prompt
tokens and gives the model the real conversation.

**`Handoff`** — every other backend, and **every truncated fork**. The resume id is
cleared and `build_fork_handoff_prompt` wraps the copied Jean history in a hidden
`<jean_fork_handoff>` block, prepended to the user's message. Only
`message_for_backend` carries it; `RunEntry.user_message` keeps the original text, so
it never appears in the transcript.

A truncated fork can never go native: `--fork-session` branches from the *end* of the
backend's transcript, which would hand the model exactly the turns the fork dropped.

Codex is handoff-only today. If its app-server gains a fork option on `thread/resume`
(check with `codex app-server generate-json-schema --out ./codex-schema`), add it to
`fork_strategy` the same way.

### Precedence on the first turn

`resolve_handoff_kind` in `chat/commands.rs` orders the injections, because a provider or
profile switch already replays the full Jean-local history:

| backend switch | profile switch | `pending_fork` | result |
| --- | --- | --- | --- |
| yes | any | any | `ProviderSwitch` |
| no | yes | any | `ClaudeProfile` |
| no | no | `Handoff` | `Fork` |
| no | no | `Native` | `NativeFork` — no injection, resume id kept |
| no | no | none | `None` |

Only `NativeFork` (and `None`) leave the target's resume id in place;
`HandoffKind::clears_target_resume()` encodes that.

## Adding a command

`fork_session_in_place` is registered only in
`jean-core/src/http_server/dispatch.rs`. There is no second registration: the Tauri
`generate_handler![]` list holds a single `dispatch_core_command` that forwards every
command to `dispatch_command`.
