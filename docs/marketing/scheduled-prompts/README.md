# Scheduled prompts: review, examples and screenshots

Feature: [#38](https://github.com/azeitler/splitkick/issues/38), shipped in 1.5.5
(2026-11-08). Developer notes: [`docs/developer/scheduled-prompts.md`](../../developer/scheduled-prompts.md).

This folder is the hand-off for the website and docs agents:

1. [Review result](#1-review-result): what works, what does not, issues and fixes.
2. [Example catalog](#2-example-catalog): 14 schedules that users would set up.
3. [Screenshots](#3-screenshots): 18 files (9 views, light and dark) with captions.

Wording rules for the website and docs come from the review. See
[What not to promise](#what-not-to-promise-yet).

---

## 1. Review result

### How it was tested

- Debug build of `main` at `dc000d80` (1.5.5 code), then again with the fixes
  of `ae5f4b06`. Own data folders (`SPLITKICK_DATA_DIR=tmp/data-sched` for the
  review, `tmp/data-sched-demo` for the screenshots), never the production
  data. Web access on `127.0.0.1:39871` / `:39872`,
  `RUST_MIN_STACK=33554432`.
- Demo projects only: `acme-web`, `acme-api`, `acme-mobile` (git repos in
  `/tmp/sk-demo`, commits by "Demo").
- Real runs with Claude (Haiku 5.5 for test runs, Sonnet 5.5 for the demo
  chats). Runs were set 1–2 minutes out and fired on their own.
- The UI was driven with Playwright through web access (1440×900, 2×).
- A separate code review of the schedule code (Rust and React) ran in
  parallel; every finding below was checked live or in the code.

### What works

| Path | Result |
| --- | --- |
| Composer arrow → *Send later…* into this session | Works. Fired at the minute, also with no client open. Reply arrived in the same session. |
| Composer arrow → *Repeat…* into a new session per run | Works. Each run makes a new session in the worktree (named after the schedule, then auto-named). |
| Settings snapshot | Works. Backend, model, effort, mode and MCP servers of the toolbar go with the schedule. |
| Edit (prompt, time, rule, target, name) | Works. The next run is computed again at once. |
| Pause / resume | Works. Resuming a one-off whose time has passed runs it at once. |
| Run now | Works. The next run time stays the same. |
| Delete | Works, in the Scheduled view and with the X in the chat banner. |
| Yolo confirm | Works. "Run unattended in Yolo mode?" shows before saving. The Yolo run edited files with nobody watching (test: it made `NOTE.md`). |
| Archived target | Works. The schedule pauses with "Session is archived and cannot run. Unarchive the session first". |
| App closed at fire time, *Run once at the next start* | Works. Missed one-off and missed repeat ran once at start; the repeat moved to its next time. |
| App closed at fire time, *Skip* | Repeat: works ("skipped"). One-off: was lost, **fixed** (#117). |
| Agent schedules through MCP (`create_schedule`, `list_schedules`) | Works. Real chat: Claude made "Weekday PR digest" (weekdays 08:30, Europe/Berlin, new session per run) and listed all schedules. The mode was capped to the chat's mode (Build). |
| Web access client | Works. The whole review ran in web access. All six schedule commands have a dispatch arm. |
| Time zones | Works. A rule in another zone shows it ("every Monday at 09:00 (America/New_York)"); the next run shows in the viewer's local time (Berlin "Nov 9th 26, 15:00", Tokyo "23:00"). |
| DST | Covered by unit tests (Europe/Berlin, 2026-03-29 and 2026-10-25; a 02:30 job in the gap runs at 03:00 and once in the overlap). Not tested live. |
| "Next" and "Last" texts | Scheduled view: "in 12h (Nov 9th 26, 07:00)" and "11h ago (07:00) · queued · *session link*". The chat banner now has the full date too (#116). |

### Issues filed

All on [azeitler/splitkick](https://github.com/azeitler/splitkick/issues).

| Issue | What | Status |
| --- | --- | --- |
| [#115](https://github.com/azeitler/splitkick/issues/115) | Schedule into a deleted session: the one-off vanishes, a repeat fails at every run. Archiving an empty session deletes it, so "new session → Send later → close it" hits this. | **Fixed** in `ae5f4b06` |
| [#116](https://github.com/azeitler/splitkick/issues/116) | Paused schedules still look active: the banner shows "next in 12h", the session stays *Scheduled*, the banner's last run has no date. | **Fixed** in `ae5f4b06` |
| [#117](https://github.com/azeitler/splitkick/issues/117) | With *Missed runs = Skip*, a missed one-off disappears without a trace. | **Fixed** in `ae5f4b06` |
| [#118](https://github.com/azeitler/splitkick/issues/118) | MCP `create_schedule` silently deletes the session's earlier agent schedule. Real chat: the second schedule deleted "Weekday PR digest". | Open, needs a decision |
| [#119](https://github.com/azeitler/splitkick/issues/119) | Closing the window quits Splitkick, so schedules do not run "when no window is open" (the dialog text). The no-window notifier is practically unreachable on desktop. | Open, needs a decision |
| [#120](https://github.com/azeitler/splitkick/issues/120) | "Last" shows `queued`, never how the run went. A run that failed with an API error still showed "queued". | Open |
| [#121](https://github.com/azeitler/splitkick/issues/121) | Edit cannot change model, mode, backend or MCP servers; a schedule with a bad model can only be deleted. | Open (improvement) |
| [#122](https://github.com/azeitler/splitkick/issues/122) | `schedules.json` keeps MCP server secrets (env tokens) in plain text, mode 0644. | Open |
| [#123](https://github.com/azeitler/splitkick/issues/123) | Smaller code-review findings: Run now can send twice, a deleted schedule can come back, agent mode is frozen, tool card spins, labels do not tick, small UX points. | Open |
| [#124](https://github.com/azeitler/splitkick/issues/124) | The schedule banner scrolls away in a chat with history; after scheduling the user sees only the toast. | Open |

### What I fixed

Commit `ae5f4b06` — *fix(schedules): pause on a deleted session, show paused
schedules as paused* (Fixes #115, #116, #117; Refs #38):

- The fire checks the worktree's session index, so a deleted session pauses
  the schedule with "The session no longer exists" (and its metadata is not
  written again).
- `next_wakeup_for_session` skips paused schedules.
- Chat banner: "paused" instead of the next run; last run with full date.
- A skipped missed one-off stays, paused, with last result "skipped".
- Tests: 3 new Rust tests, 1 new banner test. Gates: typecheck, ESLint,
  Vitest (4016 tests), `cargo fmt`, `cargo +1.99.1 clippy -- -D warnings`,
  `cargo test --lib` (1658 tests) all pass. All three fixes checked live in
  the rebuilt app.

### Not verified

- **The native notification.** This session has no screen recording
  permission (captures are black), so the banner could not be captured or
  seen. Because closing the window quits the app (#119), the no-window path
  could not be reached anyway. With the window in the background, the normal
  session notification path applies (not visible from here).
- Native window screenshots: all screenshots come from web access (same UI,
  no macOS title bar buttons, keyboard hints hidden).
- Windows and Linux, remote hosts, the headless server.

### What not to promise (yet)

- Do not write "runs even when Splitkick is closed" or "when no window is
  open". True today: schedules run while Splitkick runs (also in the
  background); a schedule missed while it was closed runs once at the next
  start (or is skipped, a setting). See #119.
- Do not say the Scheduled view shows whether a run succeeded. It shows when
  it ran and links the session (#120).
- Say "Agents can schedule prompts", but do not show one agent making several
  schedules in one chat until #118 is fixed.

### Tips that came out of the real runs

- **Tell the agent not to ask.** All three demo runs stopped with a question,
  because the demo repos lack the facts (no shop URL, no tests, no tags). An
  unattended run that asks waits until someone answers. Add a line like
  "Do not ask questions. Make reasonable assumptions and list them at the
  top." to every scheduled prompt.
- **Plan mode is fine for reports.** Shell commands (`git`, `gh`, `curl`) run
  in Plan mode too; Plan only blocks edits.
- **Use Yolo only for jobs that must change code without a person** (open a
  PR). The confirm dialog is there for that reason.
- **The run uses your real tools and accounts.** A prompt like "check the
  error tracker" uses the CLIs and MCP servers of your machine. That is the
  point in real use; in a demo it pulled real data, and the run was deleted.

---

## 2. Example catalog

Fields: rule, target, mode (and why), the exact prompt, the tools it needs,
and what the user gets. Every prompt ends with the "do not ask" line from the
tips above (shown once here as **[no-questions]**: "Do not ask questions.
Make reasonable assumptions and list them at the top.").

**Ran end to end?** = in the isolated build:
✅ fired on its own at its time · ▶️ ran with *Run now* · 🛠 created (UI or
MCP) and shown, not run · — not set up.

| # | Title | Rule | Target | Mode | Ran? |
| --- | --- | --- | --- | --- | --- |
| 1 | Daily website performance | Every day 07:00 | New session | Plan | ▶️ |
| 2 | Weekday PR and CI digest | Weekdays 08:30 | New session | Plan (agent: Build) | 🛠 via MCP |
| 3 | Monday dependency and security update | Every Monday 09:00 | New session | Yolo | 🛠 (Yolo path ✅) |
| 4 | Nightly e2e run and flaky tests | Every day 02:00 | New session | Yolo | ▶️ (in Build) |
| 5 | Friday release notes | Every Friday 16:00 | New session | Plan | ▶️ |
| 6 | Hourly crash check | Every hour at :15 | New session | Plan | ▶️ (stopped, see tips) |
| 7 | Look at this branch again tomorrow | Once, tomorrow 09:00 | This session | Plan | 🛠 (same flow ✅) |
| 8 | Staging smoke test | Weekdays 06:30 | New session | Build | 🛠 (paused) |
| 9 | US team weekly summary | Every Monday 09:00 America/New_York | New session | Plan | 🛠 |
| 10 | Weekly SEO health check | Every Monday 08:00 | New session | Plan | — |
| 11 | Daily stand-up notes | Weekdays 09:00 | New session | Plan | — |
| 12 | TLS certificate and uptime check | Every day 06:00 | New session | Plan | — |
| 13 | Docs drift check | Every Wednesday 10:00 | New session | Build | — |
| 14 | Agent follow-up: re-check a failing deploy | Once, in 1 hour (agent) | This session | Same as chat | 🛠 (MCP create tested) |

The ✅ for 3 and 7 means the path was tested with test prompts that fired on
their own (a Yolo one-off, *Send later* into this session); the example
prompt itself was not run. No agent-made schedule fired during the test (they
were all for later times); they use the same fire path.

### 1. Daily website performance

- **Rule:** Repeat → Every day → 07:00. **Target:** a new session each run
  (clean context, one unread report per day).
- **Mode:** Plan — read-only; it measures and reports, it changes nothing.
- **Prompt:** "Summarize yesterday's website performance for the shop at
  https://shop.acme.example: Core Web Vitals (LCP, INP, CLS) for mobile and
  desktop, Lighthouse scores for home, category, product and checkout, the 5
  slowest pages, and anything that got worse since the day before. End with a
  short list of the 3 most useful fixes. [no-questions]"
- **Tools:** an analytics MCP (e.g. self-hosted Matomo or Plausible), the
  Google Search Console MCP for field data, Playwright MCP or the Lighthouse
  CI CLI for lab scores.
- **User gets:** one session per morning with a short report and fixes.

### 2. Weekday PR and CI digest

- **Rule:** Weekdays 08:30. **Target:** a new session each run.
- **Mode:** Plan — read-only. (When an agent makes it through MCP, the mode
  is the chat's mode or lower; in the demo that was Build.)
- **Prompt:** "Give me a digest of the open pull requests and failing CI
  checks of this repo. For each PR: title, author, age, review state and CI
  state, failing items first. Read only: do not comment, merge or change any
  PR. [no-questions]"
- **Tools:** GitHub CLI (`gh`) or the GitHub MCP.
- **User gets:** a morning list of what needs review and what is red.

### 3. Monday dependency and security update

- **Rule:** Every Monday 09:00. **Target:** a new session each run.
- **Mode:** Yolo — it must edit files, run tests, push a branch and open a PR
  with nobody there to approve. Splitkick asks for a confirm when you save it.
- **Prompt:** "Check dependencies and security advisories. Update what is safe
  to update (patch and minor versions), run the tests, and open one pull
  request with the changes and a short summary. Do not update major versions;
  list them in the PR instead. [no-questions]"
- **Tools:** package manager (yarn, bun, cargo), test runner, `gh` to push and
  open the PR; optional OSV or GitHub security advisories.
- **User gets:** a ready PR every Monday, or "nothing to update".

### 4. Nightly e2e run and flaky tests

- **Rule:** Every day 02:00. **Target:** a new session each run.
- **Mode:** Yolo with "do not change code" in the prompt — the suite needs
  shell commands and nobody approves at 02:00. (Tested in Build; it worked,
  then waited on a question.)
- **Prompt:** "Run the end-to-end test suite three times. Report failing
  tests, and mark a test as flaky when it fails in some runs and passes in
  others. Do not change code. [no-questions]"
- **Tools:** the e2e runner (Playwright, Cypress), shell.
- **User gets:** a morning list of real failures and flaky tests.

### 5. Friday release notes

- **Rule:** Every Friday 16:00. **Target:** a new session each run.
- **Mode:** Plan — it drafts text, it does not publish.
- **Prompt:** "Draft release notes for this week from the merged pull
  requests and the commits on main since the last tag. Group them as Added,
  Changed, Fixed. One line per change, with the PR link. [no-questions]"
- **Tools:** `git`, `gh`.
- **User gets:** a draft to paste into the release.

### 6. Hourly crash check

- **Rule:** Every hour at :15 (custom `15 * * * *` or Every hour). **Target:**
  a new session each run.
- **Mode:** Plan — read-only.
- **Prompt:** "Check the error tracker for new crashes and error spikes in the
  last hour. Group them by issue, show count, first seen and the release. Say
  'no new crashes' if there are none. [no-questions]"
- **Tools:** Sentry CLI or MCP, Bugsnag CLI, or self-hosted GlitchTip.
- **User gets:** an hourly session; most say "no new crashes".
- **Note:** 24 sessions a day. Archive old ones, or run it every 3 hours.

### 7. Look at this branch again tomorrow

- **Rule:** Send later → *Tomorrow 09:00*. **Target:** this session (it keeps
  the context of the work).
- **Mode:** Plan.
- **Prompt:** "Look at this branch again: did the image lazy-loading change
  improve LCP on the product pages? Compare with the numbers from today."
- **Tools:** whatever the session already used (Playwright, Lighthouse).
- **User gets:** the follow-up answer in the same chat, next morning.

### 8. Staging smoke test

- **Rule:** Weekdays 06:30. **Target:** a new session each run.
- **Mode:** Build.
- **Prompt:** "Open the staging shop, add a product to the cart, start
  checkout and report every error in the console or network log. Take a
  screenshot of each step. [no-questions]"
- **Tools:** Playwright MCP (or agent-browser).
- **User gets:** a pass/fail report with screenshots before the team starts.

### 9. US team weekly summary

- **Rule:** Every Monday 09:00 in **America/New_York** (a rule keeps its own
  time zone; Splitkick shows the local time). **Target:** a new session.
- **Mode:** Plan.
- **Prompt:** "Summarize what changed in the app since last Monday for the US
  support team: new features, fixed bugs, known issues. Plain language, no
  internal ticket numbers. [no-questions]"
- **Tools:** `git`, `gh`, the issue tracker MCP (Linear, GitHub).
- **User gets:** a ready summary at the start of the US week.

### 10. Weekly SEO health check

- **Rule:** Every Monday 08:00. **Target:** a new session.
- **Mode:** Plan.
- **Prompt:** "Check the shop's SEO health: pages that lost impressions or
  clicks last week, new crawl or index errors, broken links and missing meta
  descriptions on the top 50 pages. List the fixes by impact. [no-questions]"
- **Tools:** Google Search Console MCP, Playwright MCP (or a link checker).
- **User gets:** a weekly SEO to-do list.

### 11. Daily stand-up notes

- **Rule:** Weekdays 09:00. **Target:** a new session.
- **Mode:** Plan.
- **Prompt:** "Write my stand-up notes: what I merged or pushed yesterday,
  which PRs wait for me, and what is blocked. Three short sections.
  [no-questions]"
- **Tools:** `git`, `gh`; optional Linear MCP.
- **User gets:** notes to read out at 09:15.

### 12. TLS certificate and uptime check

- **Rule:** Every day 06:00. **Target:** a new session.
- **Mode:** Plan (read-only shell commands such as `curl` and `openssl` run in
  Plan mode).
- **Prompt:** "For shop.acme.example, api.acme.example and docs.acme.example:
  check that each answers with HTTP 200, show the response time, and show the
  days until the TLS certificate expires. Warn when it is under 21 days.
  [no-questions]"
- **Tools:** shell (`curl`, `openssl`); optional Uptime Kuma API.
- **User gets:** an early warning before a certificate expires.

### 13. Docs drift check

- **Rule:** Every Wednesday 10:00. **Target:** a new session.
- **Mode:** Build — it may fix small mistakes in the docs.
- **Prompt:** "Compare the docs in `docs/` with the code changed in the last 7
  days. Fix outdated commands, flags and screenshots references in the docs;
  list larger gaps instead of writing new pages. [no-questions]"
- **Tools:** `git`, the repo.
- **User gets:** small doc fixes ready to commit, and a list of gaps.

### 14. Agent follow-up: re-check a failing deploy

- **Set up by an agent**, not by the user: in a chat, "The deploy is still
  rolling out. Check again in an hour and tell me if the health checks pass."
  Claude calls `create_schedule` (once, `at` in one hour) into this session.
- **Mode:** the chat's mode or lower (an agent can never raise it).
- **Tools:** Splitkick MCP (built in), plus whatever the check needs.
- **User gets:** the answer in the same chat an hour later, with no reminder
  to set. It shows in the Scheduled view with the *Agent* badge.

---

## 3. Screenshots

All from the isolated debug build (1.5.5 code with the fixes of `ae5f4b06`),
through web access in Chromium. 1440×900 window at 2× → 2880×1800 PNG.
Captured 2026-11-08 18:53–18:56 CET. Demo data only (projects `acme-web`,
`acme-api`, `acme-mobile`). Some "last run" times in the Scheduled view were
set by hand to a realistic morning (demo data); the run sessions are real.
The floating quick-menu bar and the usage meter are hidden.

Metadata: stripped, then set to Creator "Planetfall Software", Rights
"© 2026 Planetfall Software", IPTC Digital Source Type `screenCapture`
(FILE-METADATA-SOP). No visible label needed (plain screenshots).

| File (light / dark) | What it shows | Suggested caption | Alt text |
| --- | --- | --- | --- |
| `composer-menu-light-20261108-185359.png` / `composer-menu-dark-20261108-185616.png` | The composer with a performance prompt; the arrow next to Send is open with *Send later…* and *Repeat…*. | Write the prompt once, then send it later or on repeat. | The chat composer with a prompt about website performance. A menu next to the Send button shows "Send later…" and "Repeat…". |
| `repeat-dialog-daily-0700-light-20261108-185401.png` / `repeat-dialog-daily-0700-dark-20261108-185617.png` | Repeat dialog: Every day at 07:00, "Runs daily at 07:00", a new session in this worktree each run, name "Daily website performance". | A daily report at 07:00, each in a fresh session. | The Repeat dialog with the prompt, the rule "Every day" at 07:00, "Run in: A new session in this worktree each run" and the name "Daily website performance". |
| `send-later-dialog-light-20261108-185403.png` / `send-later-dialog-dark-20261108-185620.png` | Send later dialog: Tomorrow 09:00 picked, quick picks, this session, "Runs in 14h (Nov 9th 26, 09:00)". | Not now. Tomorrow at 09:00, in this chat. | The Send later dialog with a follow-up prompt, the time set to tomorrow 09:00, quick picks "In 1 hour", "Tomorrow 09:00", "Monday 09:00", and "Runs in 14h". The date field uses the computer's date format. |
| `yolo-confirm-light-20261108-185406.png` / `yolo-confirm-dark-20261108-185623.png` | The confirm before a Yolo schedule: "Run unattended in Yolo mode?" | Unattended runs with no approvals need your explicit OK. | A confirm dialog: "Run unattended in Yolo mode? The scheduled run can edit files, commit and run commands with nobody watching." with Cancel and "Schedule in Yolo mode". |
| `chat-banner-light-20261108-185409.png` / `chat-banner-dark-20261108-185626.png` | A chat with four schedule banners: a paused weekday smoke test, the daily 07:00 report with its last run, tomorrow's one-off, the Friday release notes. | Every schedule of a chat stays in view, with its next and last run. | The top of a chat with four bars: "Repeats weekdays at 06:30 · paused · last 2d ago · skipped", "Repeats daily at 07:00 · next in 12h · last 11h ago", "Scheduled · in 14h (Nov 9th 26, 09:00)" and "Repeats every Friday at 16:00", each with its prompt and an X. |
| `scheduled-view-light-20261108-185413.png` / `scheduled-view-dark-20261108-185629.png` | The Scheduled view (sidebar row above Archived): hourly crash check, nightly e2e run, daily website performance, the agent's weekday PR digest, a one-off. | Every schedule in every project, in one list. | The Scheduled view: cards for "Hourly crash check", "Nightly e2e run", "Daily website performance", "Weekday PR digest" (Agent badge) and "Re-check LCP fix", each with where it runs, the rule, the next run and the last result, and buttons to pause, edit, run now and delete. |
| `scheduled-view-more-light-20261108-185413.png` / `scheduled-view-more-dark-20261108-185630.png` | The same view scrolled: a Yolo dependency check, a New York time-zone schedule, Friday release notes, a paused staging smoke test. | Pause, edit or run any schedule now. Time zones included. | More cards: "Monday dependency check" with a Yolo badge, "US team weekly summary" with the rule "every Monday at 09:00 (America/New_York)", "Friday release notes", and a paused "Staging smoke test" with last result "skipped". |
| `missed-runs-setting-light-20261108-185416.png` / `missed-runs-setting-dark-20261108-185633.png` | Settings → General → Scheduled prompts → Missed runs: "Run once at the next start". | Laptop closed at 07:00? The run happens once when you are back. | Settings, General page, section "Scheduled prompts": the setting "Missed runs" set to "Run once at the next start", with the help text that a repeating schedule runs at most once. |
| `mcp-agent-chat-light-20261108-185422.png` / `mcp-agent-chat-dark-20261108-185639.png` | A real chat: the user asks for a weekday PR digest; Claude creates it with the Splitkick MCP tool and lists all schedules. The new schedule's banner is at the top. | Ask the agent. It sets up the schedule for you. | A chat in acme-api: the user asks "Every weekday at 08:30, give me a digest of the open pull requests and failing CI checks … Set it up as a Splitkick schedule". Claude answers that it created "Weekday PR digest" and shows a recap. Banners at the top list the schedules of the session. |

Not captured: the native notification (no screen recording permission in
this session; see [Not verified](#not-verified)).

### Re-create the screenshots

Scripts are not committed (scratch). The setup was: build with
`bunx tauri build --debug --no-bundle --config src-tauri/tauri.conf.dev.json`,
start `src-tauri/target/debug/jean` with `SPLITKICK_DATA_DIR=<repo>/tmp/<dir>`
and `RUST_MIN_STACK=33554432` from a neutral folder (the repo root has a
`.tool-versions` that breaks the Claude CLI check), enable web access on a
free port in that data folder's `preferences.json`, then drive
`http://127.0.0.1:<port>/` with Playwright (viewport 1440×900,
`deviceScaleFactor: 2`, `PW_TEST_SCREENSHOT_NO_FONTS_READY=1`). For dark
shots set `theme` to `dark` in that `preferences.json` and restart.
