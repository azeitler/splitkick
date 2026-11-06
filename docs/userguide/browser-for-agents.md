# Browser for agents

Your coding agents can use a web browser: open pages, read them, click, fill in
forms. Splitkick adds the browser as an MCP server to every CLI you installed
(Claude, Codex, OpenCode, Cursor, Grok, Kimi, Antigravity), so you do not edit
their config files yourself.

Open **Settings → MCP Servers → Browser for agents** and choose an engine.

| Engine                          | What the agent drives                                                                                      | Good for                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Off**                         | Nothing. Splitkick removes the browser server it added.                                                    |                                                    |
| **Agent Browser**               | A Chromium with a Splitkick login profile ([agent-browser](https://github.com/vercel-labs/agent-browser)). | Servers, and logins you make once in that profile. |
| **Playwright**                  | Its own browser window and profile ([Playwright MCP](https://github.com/microsoft/playwright-mcp)).        | Testing your web app, pages without a login.       |
| **Playwright with your Chrome** | Your real Chrome, with all your logins, through the Playwright extension.                                  | Work in tools where you are already signed in.     |

When you change the engine, Splitkick writes the new server into each CLI's
config and removes the old one. Each change keeps a backup of the config file
next to it (`….bak.<time>`). Sessions that already run keep the old server;
start a new session to use the new engine.

## Playwright with your Chrome

> **Warning:** agents can act in your real, logged-in browser. They can read
> your mail and click buttons on any site where you are signed in. Use this
> engine only with agents and prompts that you trust.

1. Install the [Playwright extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
   in Chrome (the link is also in the settings).
2. Click the extension icon. It shows the connection token
   (`PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`). Copy the token.
3. Choose **Playwright with your Chrome** and confirm the warning.
4. Paste the token and click **Save token**.
5. Click **Test connection**. Chrome opens a Playwright tab and Splitkick shows
   your open tabs.

Without a token, the extension asks you to approve each connection in Chrome.

**Where the token is kept:** in the macOS Keychain (item _Splitkick Playwright
extension token_), never in a config file. When an agent starts the browser
server, Splitkick reads the token and gives it to Playwright MCP in its
environment. The token is never in a command line, and Web Access never
receives it. To use a new token, click **Generate new token** in the extension,
then save the new token in Splitkick.

## Playwright (own browser)

Playwright opens its own Chrome window. It keeps a profile per project folder,
so logins stay between sessions. Node.js 18 or newer must be installed.

By default Splitkick starts Playwright MCP with `npx @playwright/mcp@latest`.
Click **Install Playwright MCP** to install it into Splitkick's data instead;
then the browser server starts faster and works offline.

## You set up Playwright yourself before

If a CLI config already has a Playwright server (for example `playwright` in
`~/.claude.json` with your token in it), Splitkick does not add a second one.
The settings list those servers. Click **Take over** to let Splitkick manage
them: Splitkick removes your entry (the backup keeps it) and writes its own.
After that, remove the token from your old setup, such as `~/.zshenv`, if no
other tool needs it.

## Web Access

In Web Access, and in a desktop window connected to another instance, the
setting is read-only. You see the engine and whether a token is saved, but not
the token. Change the engine in the desktop app on the host.
