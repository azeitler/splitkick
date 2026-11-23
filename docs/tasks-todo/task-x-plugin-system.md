# Task: Plugin system (folder plugins with side-panel views)

Status: backlog, not prioritized. Filed 2026-11-13.
Source: the maintainer's research note on the NotePlan plugin system
(private notes, 2026-11-13).

## Goal

A user or an agent can add a small tool to Splitkick by copying a folder. The tool
adds commands to the command palette and an HTML view to the left side panel. It
needs no store, no build step and no Splitkick release.

Example: a "Umami" plugin shows the analytics of the open project in the side
panel; an "Attio" plugin shows the CRM record for the client of a project.

## Where it fits in the release plan

- **Not in a 1.5.x patch.** Releases are patch bumps by default; this is a new
  feature area and needs a minor release (Andreas decides when).
- **After** the open feature work: schedules (#120–#124), memory (#128, #129),
  the tray icon (#127) and the server plan.
- **Start with a design spike** (security model, see below). Do not start code
  before Andreas approves the spike.

## What we take from NotePlan

1. **Plugin = folder.** `plugin.json` (manifest) + HTML/JS assets. To install,
   copy the folder. To uninstall, delete it.
2. **Commands in the manifest** go into the command palette (`src/lib/commands/`),
   with aliases.
3. **Settings as a schema** in the manifest. Splitkick makes the form (Settings →
   Plugins). Values live apart from the code, so a code update keeps them.
4. **Side-panel views per command:** id, title, icon, colour. A new tab type in
   the left `ContextPanel` (today `files | network | graph | artifacts`), with a
   reload button and the theme as CSS variables.
5. **Agent-friendly:** an agent can install, run and check a plugin without the UI.
   - Run: a link `splitkick://plugin/<id>/<command>` (extend `jean-core/src/links.rs`)
     and a Splitkick MCP tool (`run_plugin_command`, `reload_plugins`).
   - Check: one log file per plugin (`<plugin>/console.log`, console output of the
     view, with a timestamp per run).

## Where we do better than NotePlan

- **Registration follows the files.** A plugin folder that is present is
  registered on start and on a folder change. No "run once on each machine".
- **Secrets in the Keychain**, not in synced plain text. A settings field with
  `"secret": true` is stored through `jean-core/src/secret_store.rs`. (Same rule
  as #122 for schedules.)
- **Sync is optional.** The default folder is in the Splitkick data folder. The
  user can choose a synced folder (iCloud Drive) in Settings.

## Security model (the main open question)

NotePlan runs plugin JS with full host access. Splitkick runs agents with shell
access to user code, so a plugin must not get more than it needs.

Proposal for phase 1:

- **No plugin code in the host.** Phase 1 has only declarative manifests plus
  views. A view runs in a sandboxed iframe (as the HTML preview rich block does),
  not in the app's webview context.
- **Network:** a view gets a host fetch bridge (`postMessage`) that is CORS-free
  but only for the hosts the manifest lists in `"permissions.hosts"`. The user
  confirms the host list at install.
- **Context:** the view gets read-only context through the bridge (open project,
  worktree, session id, theme). No file system, no shell, no chat write in phase 1.
- Web access and remote windows: views load from the host that has the plugin
  folder; check CSP and the WebSocket transport.

## Phases

1. **Spike (design doc):** manifest format, folder location, security model,
   bridge API, how web access serves plugin assets. Output: a design doc in
   `docs/developer/` for approval.
2. **MVP:** load folders, palette commands, side-panel view tab, settings form
   with Keychain secrets, log file, link + MCP tool to run a command. One sample
   plugin in `docs/` (e.g. a status page view).
3. **Later:** commands that do actions through the bridge (open a session, send a
   prompt) with per-permission consent; a catalogue of shared plugins.

## Done when (MVP)

- [ ] Copying a plugin folder adds its commands to the palette without a restart.
- [ ] A command opens its view as a tab in the left panel, with reload and theme.
- [ ] Settings form from the schema; secret fields stored in the Keychain.
- [ ] The view can fetch only from its declared hosts.
- [ ] `splitkick://plugin/<id>/<command>` and the MCP tool run a command; the
      plugin log file shows the run.
- [ ] Works in the native app and in web access.
- [ ] Unit and e2e tests; user guide page.
