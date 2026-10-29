# Local two-instance E2E run

`bun run test:e2e:local` checks the features that need a real backend or two
instances: session transfer, remote connections, session links, follow-ups,
MCP sends and parent/child sessions (issue #65). It runs on one Mac and never
touches your real data.

The mocked suite (`bun run test:e2e`, see [testing.md](testing.md)) stays the
fast check for the UI alone.

## What it does

1. `bun run build` (the web UI), then `cargo build` of the desktop app (debug).
2. Starts the desktop binary twice in `--headless` mode: **A** (local) and
   **B** (remote). This is `jean_core::run_server()`, the same server the app
   uses for Web Access.
3. Seeds fixture data through `POST /api/invoke`: a throwaway git repo `alpha`
   on each instance, one worktree each, and a session `B-only marker` on B.
4. Runs the Playwright specs in `e2e/local/tests/` against the real web UI of
   each instance (`http://127.0.0.1:<port>/?token=<token>`).
5. Stops both instances, checks for leaks, removes the temp folders.

| Scenario                        | Spec                        | Checks                                                                                                                 |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A uses B as a remote connection | `remote-connection.spec.ts` | Command palette switches the window to B and back                                                                      |
| Transfer A → B (#35)            | `transfer.spec.ts`          | Real menu + dialog; B has the history, the pasted text and image, the saved context; the follow-up on B gets all three |
| Session link (#44)              | `sessions.spec.ts`          | Link shows the session name and path, unknown id shows "not found", click opens it                                     |
| Follow-up list (#46)            | `sessions.spec.ts`          | MCP `add_follow_up` fills the badge and panel; add, mark done, reload                                                  |
| MCP send keeps the mode (#61)   | `sessions.spec.ts`          | `send_chat_message` with `executionMode: "yolo"` runs in Yolo and keeps it after reload                                |
| Parent/child inserts (#62)      | `sessions.spec.ts`          | "Sent to session …" and "Started session …" in the parent, "Started by …" in the child                                 |
| Auto-archive (#50)              | `auto-archive.spec.ts`      | API level: a merged PR archives a clean worktree                                                                       |

## Sealing

Each instance gets its own root under `/tmp/sk-e2e-<name>-XXXX/` (short on
purpose: macOS limits socket paths to 104 bytes):

- `home/` is `HOME`. Every home path in jean-core goes through `dirs`, which
  reads `$HOME`, so worktrees (`~/splitkick`), skill sync, agent configs and
  CLI caches land here.
- `data/` is `SPLITKICK_DATA_DIR`. `preferences.json` is written before the
  start: token, `auto_update_ai_backends: false`, first-run dialogs off.
- `repos/` holds the fixture git repos.
- `SPLITKICK_IMPORT_SOURCE` points to a missing folder: no Jean import.
- Each instance allows only the other's origin (`JEAN_ALLOWED_ORIGINS`).

Teardown fails the run when it finds a trace of the run in the real home
folder: the temp roots in `~/.claude.json`, `~/.codex/config.toml`,
`~/.cursor/mcp.json`, opencode's config or a real Splitkick `projects.json`,
or the fixture worktrees in `~/splitkick/alpha`.

Not sealed: the web UI checks the public update feed (read only), and
`git`/`gh` come from the login shell `PATH`.

## The stub agent

No real agent runs. `e2e/local/stub-claude.mjs` is installed as the managed
Claude CLI (`<data>/claude-cli/claude`) and answers in Claude's stream-json:

```
STUB REPLY mode=<execution mode>. Seen markers: <E2E-* tokens>
```

The markers come from its stdin, its arguments and every file whose `/tmp` or
`/var` path appears in them. A reply that lists `E2E-SECRET-HISTORY`,
`E2E-SECRET-PASTE` and `E2E-SECRET-CONTEXT` proves that the history, the pasted
file and the saved context reached the agent.

Script lines in a user message:

- `STUB:say <text>` adds `<text>` to the reply (for markdown links).
- `STUB:mcp <tool> <json>` calls the Splitkick MCP socket as the sending
  session and puts a real `tool_use`/`tool_result` pair into the run log.

The stub execs Node by absolute path: the server replaces `PATH` with the
login shell's, and the temp `HOME` has no shell profile.

## Commands and artefacts

```bash
bun run test:e2e:local        # build everything, then run
bun run test:e2e:local:only   # run without rebuilding
E2E_KEEP=1 bun run test:e2e:local:only   # keep the /tmp roots after the run
```

Every run writes `tmp/e2e-local/<YYYYMMDD-HHMMSS>/`: named screenshots
(`screens/`), Playwright results with traces of failed tests (`results/`), the
HTML report (`report/`), both server logs and copies of both data folders.

To work on one scenario against running instances, start them once (for
example with `E2E_KEEP=1` and a script that calls `global-setup.ts`), then:

```bash
E2E_REUSE=1 E2E_LOCAL_RUN_DIR=$PWD/tmp/e2e-local/<run> bun run test:e2e:local:only transfer
```

Specs use unique session names (`uniqueName()`), so they can run again
against the same instances.

## Limits

- Native windows (connection windows, the desktop menu bar) are not covered:
  Playwright cannot drive WKWebView. The transfer runs in Web Access, through
  the same dialog and `remoteInvoke` as the desktop app.
- Real agent CLIs are not covered.
- Local only; there is no CI job.
