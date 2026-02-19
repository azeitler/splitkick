#!/usr/bin/env bash
# Custom AppRun: Fix WebKitGTK compatibility on rolling-release distros
#
# Problem: The default AppRun.wrapped binary hardcodes LD_LIBRARY_PATH to
# prioritize bundled Ubuntu 22.04 libraries. On newer distros (Arch, Fedora 40+,
# etc.), these bundled libraries conflict with system GPU drivers and Mesa,
# causing blank/white screens or crashes.
#
# Solution: Replace AppRun with a shell script that sources GTK hooks,
# sets LD_LIBRARY_PATH to prefer system libraries when system WebKitGTK
# is available, and then execs the Jean binary directly.
#
# Related issues:
# - https://github.com/coollabsio/jean/issues/52
# - https://github.com/coollabsio/jean/issues/55
# - https://github.com/coollabsio/jean/issues/71

set -e

APPDIR="$(dirname "$(readlink -f "$0")")"
export APPDIR

# Source GTK plugin hooks (sets GDK_BACKEND, GTK_THEME, etc.)
for hook in "$APPDIR"/apprun-hooks/*.sh; do
    [ -f "$hook" ] && . "$hook"
done

# If system WebKitGTK 4.1 is available, prefer system libraries over bundled ones.
# This avoids conflicts between old bundled libs and newer system GPU drivers/Mesa.
if [ -f /usr/lib/libwebkit2gtk-4.1.so.0 ] || [ -f /usr/lib64/libwebkit2gtk-4.1.so.0 ]; then
    export LD_LIBRARY_PATH="/usr/lib:/usr/lib64"
else
    # Fallback: use bundled libraries (standard AppImage behavior)
    export LD_LIBRARY_PATH="$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu:$APPDIR/usr/lib64:$APPDIR/lib:$APPDIR/lib/x86_64-linux-gnu"
fi

export PATH="$APPDIR/usr/bin:$PATH"
export XDG_DATA_DIRS="$APPDIR/usr/share:/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

exec "$APPDIR/usr/bin/jean" "$@"
