# OpenCode Integration (HTTP Server Mode)

## Agreed Direction

Jean will integrate OpenCode through `opencode serve` (HTTP mode), not via direct frontend SDK calls and not as a primary `opencode run` CLI integration.

Key rule: the Jean frontend never talks directly to OpenCode. All OpenCode communication happens in Jean's Rust backend.

## Why This Approach

1. Matches Jean's existing architecture: frontend -> Jean transport (`invoke`/WS) -> Rust backend.
2. Works in Jean HTTP/web mode: browser clients may be remote, but Jean backend can still talk to `127.0.0.1:<opencode-port>`.
3. Avoids localhost/CORS/network exposure problems from browser-direct provider calls.
4. Keeps provider implementation details out of UI code and preserves existing event contracts (`chat:chunk`, `chat:done`, etc).

## OpenCode Interface Strategy

Use simple Rust `reqwest` calls against OpenCode HTTP endpoints, with request/response types based on OpenAPI spec:

- Spec URL: `https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/packages/sdk/openapi.json`

Do not rely on OpenCode JS SDK in frontend. A Rust-native HTTP client is simpler and aligns with current backend-owned provider pattern.

## High-Level Architecture

1. Jean starts/manages `opencode serve` as a local child process.
2. Jean stores OpenCode server runtime config (port/auth/host policy) in app preferences.
3. Chat requests for `backend=opencode` go through `send_chat_message` backend branch.
4. Jean backend translates OpenCode streaming/events into Jean's existing chat events.
5. Session continuation uses persisted `opencode_session_id` in Jean metadata.

## Security/Networking Constraints

1. OpenCode server bind host should be localhost only (`127.0.0.1`) by default.
2. If OpenCode auth is enabled, Jean backend includes required auth headers/credentials.
3. No direct browser -> OpenCode traffic.
4. Jean HTTP mode remains the single external entrypoint.

## Scope Changes vs Previous Plan

This task replaces the prior "OpenCode CLI run-mode integration" approach.

- Previous direction: parse `opencode run --format json` output.
- New direction: call `opencode serve` HTTP API using OpenAPI-based Rust models.

CLI usage remains only for:

1. launching/stopping server process
2. status checks and diagnostics

## Planned Backend Changes

### New Modules

1. `src-tauri/src/opencode_server/`
   - Process lifecycle manager:
   - `start_opencode_server()`
   - `stop_opencode_server()`
   - `get_opencode_server_status()`
   - health checks and restart policy

2. `src-tauri/src/opencode_client/`
   - Typed HTTP client (OpenAPI-based):
   - endpoint constants
   - request/response structs
   - streaming/event parsing adapters

3. `src-tauri/src/chat/opencode.rs`
   - OpenCode chat execution bridge for Jean:
   - send message / continue session
   - map provider stream events -> Jean events
   - return unified response payload for `send_chat_message`

### Modified Rust Files

4. `src-tauri/src/chat/types.rs`
   - Add `Backend::Opencode`
   - Add persisted `opencode_session_id` on session/session metadata

5. `src-tauri/src/chat/mod.rs`
   - Add `mod opencode;`

6. `src-tauri/src/chat/commands.rs`
   - Extend `send_chat_message` backend branch for OpenCode
   - persist `opencode_session_id`
   - keep unified response and existing UI event contract

7. `src-tauri/src/lib.rs`
   - register OpenCode server/client management commands
   - wire new modules

8. `src-tauri/src/http_server/dispatch.rs`
   - expose any new OpenCode management commands for web mode parity

## Planned Frontend Changes

1. Add OpenCode to backend selector:
   - `claude | codex | opencode`
2. Keep UI transport unchanged (`src/lib/transport.ts` pattern).
3. Use existing chat streaming/tool rendering paths.
4. Add OpenCode model discovery/status hooks that call Jean backend commands.

Likely files:

- `src/types/chat.ts`
- `src/store/chat-store.ts`
- `src/types/preferences.ts`
- `src/components/chat/ChatToolbar.tsx`
- `src/services/*` (new OpenCode service hooks)

## Execution Mode Notes

Initial behavior:

1. plan/build supported first
2. yolo support deferred until mapped safely to OpenCode semantics

## Implementation Phases

### Phase 1: Core Backend Plumbing

1. Add backend enum/state/types (`opencode`, `opencode_session_id`)
2. Implement OpenCode server lifecycle manager
3. Implement minimal OpenCode HTTP client from OpenAPI
4. Add status/health/model-list commands

### Phase 2: Chat Path Integration

1. Add `Backend::Opencode` branch to `send_chat_message`
2. Implement stream/event translation to Jean events
3. Persist and resume with `opencode_session_id`

### Phase 3: Frontend Wiring

1. Add provider switch + dynamic model list
2. Add setup/status UI for server readiness/errors
3. Keep existing chat UI contract unchanged

### Phase 4: Hardening

1. Retry and reconnect behavior for OpenCode server
2. Better diagnostics/logging
3. Optional auth and config controls

## Verification Plan

1. Unit tests:
   - OpenCode event -> Jean event mapping
   - session resume ID persistence
2. Integration tests:
   - start server -> send message -> receive stream -> complete
   - server down -> auto-start/recover path
3. Manual tests:
   - Native mode chat with OpenCode
   - Jean HTTP/web mode chat with OpenCode (remote browser)
   - model listing and provider switch

## Final Decisions Captured

1. Chosen path: `opencode serve` HTTP mode.
2. Communication: Rust backend HTTP calls based on OpenAPI.
3. Frontend does not call OpenCode directly.
4. Jean remains the only client-facing transport in both native and HTTP/web modes.
