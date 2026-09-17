# Claude dialog tool harness — pre-implementation rig

Validates the design for [azeitler/jean#1](https://github.com/azeitler/jean/issues/1) against the
**real** Claude CLI and a **real** model, before any Rust is written. It reproduces Jean's topology:

```
claude --print                     <- real CLI, real model, real AskUserQuestion
   └─ spawns ─> shim.py            <- stands in for jean_mcp_stdio.rs
        └─ unix socket ─> app.py   <- stands in for jean_mcp_socket.rs + the desktop app
             └─ parks the dialog until answer.py resolves it   <- the human
```

`shim.py` carries the fixes the Rust port needs, each behind a `DEGRADE` switch so you can
disable one and confirm the rig detects its absence.

## Commands, with their verified outcomes

| command                                          | outcome                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `./run.sh 35 none`                               | **PASS** — dialog parks 35s, answered out-of-band, model continues                                          |
| `./run.sh 10 r1`                                 | **FAIL, exit=1** — risk 1: `--permission-prompt-tool` names a server that isn't configured                  |
| `RIG_NO_SERVER_TIMEOUT=1 ./run.sh 70 b1 35000`   | **FAIL** — `sent no response or progress for 60s; aborting` (run survives, `exit=0`, soft `tool_use_error`) |
| `RIG_NO_SERVER_TIMEOUT=1 ./run.sh 70 none 35000` | **PASS** — the pinger rescues the same scenario                                                             |
| `./run.sh 70 b1 35000`                           | **PASS** — per-server `timeout` alone suppresses the idle abort                                             |

The last two rows are the point: **there are two independent mitigations** for a long park —
a per-server `timeout` on the MCP entry, or `notifications/progress`. Either suffices.

Watch a dialog live from a second terminal while one is parked:

```bash
python3 answer.py list        # show the parked question and its options
python3 answer.py 1 Redis     # answer it yourself
```

Override the CLI with `CLAUDE_CLI=/path/to/claude` to test a pinned version.

## Why keep this after implementation

The feature depends entirely on undocumented CLI internals (`--permission-prompt-tool` gating
`AskUserQuestion`/`EnterPlanMode`/`ExitPlanMode`). `run.sh` doubles as a **contract test**: a
Claude CLI upgrade that moves the gate fails loudly here instead of silently degrading to
plain-text prompts — which is exactly how upstream #460 went unnoticed.
