# Splitkick on your iPhone (Home Screen app)

Web Access works in Safari on a phone. Added to the Home Screen, it opens
full screen like an app.

## Set it up

1. Use an HTTPS address. With Tailscale, run this on the Mac:

   ```bash
   tailscale serve --bg 3456
   ```

   3456 is the Web Access port (Settings → Web Access). The phone then opens
   `https://<mac>.<tailnet>.ts.net/`. Web Access can stay on "localhost
   only", because `tailscale serve` connects from the Mac itself.

2. Open that address in Safari and enter the access token.
3. Tap Share → Add to Home Screen.

A plain `http://100.x.y.z:3456` address works too, but without the app cache
below. Each address keeps its own login and view, so a new address asks for
the token again.

## What to expect

iOS ends a Home Screen app in the background when it needs memory. The next
open loads the app again. Splitkick makes that cheap:

- **Your view comes back.** The phone reopens its own project, session and
  tab. It does not take the desktop's view, and it does not change it.
- **The app cache.** On HTTPS the app is kept on the phone, so it starts at
  once, also on a slow link. When the Mac cannot be reached, the app opens
  on its loading screen instead of a Safari error page. Your sessions still
  need the Mac.
- **Updates.** After Splitkick on the Mac was updated, a toast says
  "Splitkick was updated". Tap Reload to load the new version.

Settings → Web Access → **This device** shows:

- how often the app started again after iOS ended it (Copy log, Clear log);
- whether the app cache is on, and **Reset app cache**, which removes it
  and loads the app from the Mac again.

The app cannot send push notifications yet, and it does not work offline.
