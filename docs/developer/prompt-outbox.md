# Prompt Outbox

**Rule: a prompt the user submitted is never lost.** Not on a failed send, not
offline, not on a timeout, not on a reload or app quit, not in a remote window,
not in Web Access on a phone.

One module carries this rule: `src/lib/prompt-outbox.ts`. It is a small client
store, saved to `localStorage` at every change (key `jean:prompt-outbox:v1`).
Each entry holds the typed text, the message as the backend gets it, the
attachments and toolbar settings (`QueuedMessage`), session, worktree and time.

## Life of an entry

```
submit ──track──▶ pending (in flight) ──confirm──▶ removed
                        │
                        │ error / timeout / dropped socket / reload
                        ▼
                  pending (not in flight) ──recoverOutbox──▶ backend holds it? ──yes──▶ removed
                                                                     │ no
                                                                     ▼
                                                                   unsent
                                     input empty ──▶ back into the input ──▶ restored
                                     input has new text ──▶ "Unsent message" item
```

- **track** (`trackPrompt`): before the input is cleared. A second track of the
  same id (send → duplicate → enqueue) keeps the typed text and attachments.
- **confirm**: `chat:sending` with the same message (`confirmSentMessage`), the
  send result, a successful enqueue or steer. Then the backend holds it.
- **settle** (`settlePrompt`): the call ended without a confirmation. The
  outcome is open, so nothing is restored yet.
- **recoverOutbox**: runs from `usePromptOutboxRecovery` (App) when the backend
  is reachable and the UI state is hydrated (the hydration replaces the input
  drafts). It reads the session (`get_session`) and confirms an entry whose
  message is in the history (not older than the submit minus 5 min of clock
  slack) or whose id or text is in the queue. **This check is what prevents
  duplicates**: never restore without it (see 7c6d1cf8 and #671).
- **restored**: the prompt is back in the input. The entry stays until the user
  submits in that session, discards it, or changes the draft while online. An
  input draft saves through the backend; offline that save fails, and a reload
  would lose the draft.

## Hooks (the only places that touch it)

| Place                                    | What it does                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleSubmit` (`useMessageSending.ts`)  | track with the typed text, before the input is cleared; confirm after a steer                                                                            |
| `useSendMessage` (`services/chat.ts`)    | `onMutate` tracks every send (`outboxId`, `queued`); success and cancel confirm; errors settle; a duplicate re-queues under the same id                  |
| `persistEnqueue`, `persistRequeueFront`  | track, confirm on success; on failure drop the local queue copy and settle                                                                               |
| `chat:sending` (`useStreamingEvents.ts`) | `confirmSentMessage`                                                                                                                                     |
| `handleEditQueuedMessage`                | a failed edit is kept as an unsent entry (`addUnsentPrompt`)                                                                                             |
| `UnsentPrompts.tsx` (above the composer) | "Send again" (same id), "Edit" (into the input), "Discard" (no confirm, see confirm-dialogs.md); offline: "saved, will send when the connection is back" |

## Offline

`src/lib/backend-online.ts` has two signals. `useOfflineReason`
(`src/components/layout/OfflineIndicator.tsx`) picks one: `backend` before
`models`.

- `useBackendOffline`: a WebSocket client (Web Access, a desktop window on a
  remote server) lost its backend. Text: "Offline. Reconnecting…".
- `useModelsOffline`: a local instance has no network (`navigator.onLine`
  false), so the CLIs on this machine cannot reach the model APIs. Text: "No
  internet. The models cannot be reached." Not on a remote client: its own
  network says nothing about the host's. `onLine` false is reliable; true does
  not prove that the internet works, so a lost route with Wi-Fi still up shows
  no sign.

Where the sign shows: in the sidebar footer, next to the usage item, as a short
label ("Offline", "No internet") with the full text in the tooltip. Where no
sidebar footer is on screen (phone, hidden sidebar, zen mode), the chat window
shows the full text in a line above the input (`UnsentPrompts`). The footer
item counts itself while mounted (`useSidebarFooterShown`), so the sign never
shows twice. There is no floating pill: the app has none in other places.

A submit while offline takes the normal path. The transport holds the request
until the socket is back and sends it then; the outbox keeps the prompt
meanwhile, and the composer says so. If the socket drops with the request
pending, or it times out, the entry is settled and checked once the connection
is back. We chose this over holding offline submits in the outbox and sending
them later ourselves: the transport already does the sending, and every
resend from the outbox would need the duplicate check anyway.

E2E: the mock transport always reports "connected". A test sets
`__JEAN_E2E_MOCK__.offline` and dispatches `e2e:connection` on the mock's event
emitter (`e2e/tests/prompt-outbox.spec.ts`).

## Paths that take a user prompt

D = input draft, LS = `lastSentMessages` (memory), LQ = local queue copy, BQ =
backend queue. "Before" is the behaviour before the outbox.

| Path                                                                      | Call                                    | Before, on failure                                                                                                          | Now                                    |
| ------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Composer, idle send                                                       | `sendMessage.mutate`                    | D cleared first. Refusal: back into D only if D empty, else **lost**. Dropped socket or timeout: **lost**. Reload: **lost** | outbox                                 |
| Composer while a run is active                                            | `persistEnqueue`                        | Only logged. Text in LQ until the next `queue:updated` or reload: **lost**                                                  | outbox                                 |
| Composer, steer                                                           | `steer_*_turn`                          | Falls back to enqueue (row above)                                                                                           | confirm on success, else enqueue row   |
| Composer `/goal <objective>`                                              | `codex_goal_set`, then send             | D kept until the goal is set                                                                                                | outbox for the send                    |
| Question answers                                                          | `sendMessage.mutate`                    | Form locked, toast only: **lost**                                                                                           | outbox (answers as text)               |
| Plan approval (inline, canvas, clear context)                             | `sendMessage.mutate`                    | Through LS into D                                                                                                           | outbox                                 |
| Plan approval in PlanDialog                                               | `persistEnqueue`                        | Only logged (edit kept in the plan file)                                                                                    | outbox                                 |
| Permission approval resend, fix finding, follow-up "Queue", slash command | `sendMessage.mutate` / `persistEnqueue` | As the composer rows                                                                                                        | outbox                                 |
| Queue processor (desktop)                                                 | dequeue, then `sendMessage.mutate`      | Dequeued first; non-race error: into D only if empty, no attachments, else **lost**                                         | outbox (`outboxId` = queued id)        |
| Race lost, requeue                                                        | `persistRequeueFront`                   | Only logged: **lost**                                                                                                       | outbox                                 |
| "Send now" on a queued prompt                                             | move to front + cancel                  | Message stays in the queue                                                                                                  | unchanged                              |
| Edit a queued prompt                                                      | `update_queued_message`                 | Editor closed, only logged: **edit lost**                                                                                   | kept as unsent                         |
| Schedule / "Send later", agent schedule                                   | `create_schedule`                       | Dialog stays open, D cleared only after success                                                                             | unchanged (safe)                       |
| Start a role session with a message                                       | `createSession`                         | Dialog and text kept                                                                                                        | unchanged (safe)                       |
| Investigate, workflow runs, git conflict, release notes, update PR        | `sendMessage.mutate`                    | Generated prompt; into D through LS, or toast only                                                                          | outbox                                 |
| Magic "resolve conflicts"                                                 | `invoke('send_chat_message')` directly  | Toast; generated, can be made again                                                                                         | not covered (generated, no typed text) |

Not covered on purpose: a turn that the backend accepted and then undoes
(`chat:undo-send`, `chat:cancelled` with `undo_send`) still restores from LS in
memory, as before. The backend accepted it, so the outbox entry is gone.
