# Web Access

Web Access opens Splitkick in a browser on another device. Turn it on in
Settings → Web Access → Enable HTTP server. The pane lists the URLs and the
access token.

## Tailscale

When Tailscale is installed, the Web Access pane shows a **Tailscale** block.
Splitkick reads the local `tailscale` CLI; it never changes the Tailscale
settings.

- **MagicDNS name** — this machine's name in the tailnet, for example
  `box.tail1234.ts.net`, with a copy button. If MagicDNS is off in the
  tailnet, the pane says so and shows the Tailscale IP instead.
- **tailscale serve** — whether Splitkick is published with
  `tailscale serve`. Splitkick counts a serve entry when it proxies to
  `localhost`, `127.0.0.1` or `[::1]` on the Web Access port.
  - **Served:** the `https://box.tail1234.ts.net` URL is added to the Access
    URLs, with open, copy and connection-link buttons.
  - **Not served:** the pane shows the command to run in a terminal, for
    example `tailscale serve --bg 3456`. Splitkick does not run it for you.
- **Funnel warning** — if Tailscale Funnel is on for that entry, the URL is
  public on the internet, not only in your tailnet. Keep the access token on,
  or turn Funnel off with `tailscale funnel reset`.

The block is hidden when Tailscale is not installed. If Tailscale is
installed but not connected, the block says so.

### Why `tailscale serve`

Browsers treat only `https://` and `http://localhost` as secure. On a plain
`http://100.x.y.z:3456` address, clipboard copy and some other features can
fail. `tailscale serve` gives an HTTPS URL with a valid certificate. Web
Access can stay on "localhost only", because `tailscale serve` connects from
the machine itself.

Where Splitkick looks for the CLI:

- macOS: `/Applications/Tailscale.app/Contents/MacOS/tailscale`, then `PATH`
- Windows: `PATH`, then `C:\Program Files\Tailscale\tailscale.exe`
- Linux: `PATH`

See also: [Splitkick on your iPhone](phone-home-screen-app.md).
