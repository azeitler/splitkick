#!/usr/bin/env bash
# Tests for appimage-webkit-fix.sh
# Verifies the XDG_DATA_DIRS fix for Wayland environments where the variable
# may not be set, causing linuxdeploy-plugin-gtk.sh to abort under set -u.

set -e

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# Set up a minimal fake AppImage directory:
#   <appdir>/
#     appimage-webkit-fix.sh       (copy of the script under test)
#     apprun-hooks/
#       linuxdeploy-plugin-gtk.sh  (simulates the real hook: bare $XDG_DATA_DIRS ref)
#     usr/bin/jean                 (stub binary; overridden per-test to capture state)
#     usr/share/                   (empty, satisfies any path checks)
setup_appdir() {
    local appdir
    appdir="$(mktemp -d)"

    mkdir -p "$appdir/apprun-hooks" "$appdir/usr/bin" "$appdir/usr/share"

    # Copy the script under test so APPDIR resolves to $appdir.
    cp "$SCRIPT_DIR/appimage-webkit-fix.sh" "$appdir/appimage-webkit-fix.sh"
    chmod +x "$appdir/appimage-webkit-fix.sh"

    # Simulate linuxdeploy-plugin-gtk.sh line 10: bare variable reference with no default.
    # Under set -u this aborts if XDG_DATA_DIRS is unset.
    cat > "$appdir/apprun-hooks/linuxdeploy-plugin-gtk.sh" <<'EOF'
#!/usr/bin/env bash
# Simulate real hook: bare reference triggers set -u abort when unset
export XDG_DATA_DIRS="$XDG_DATA_DIRS"
EOF

    # Default stub: exits 0 silently.
    cat > "$appdir/usr/bin/jean" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$appdir/usr/bin/jean"

    echo "$appdir"
}

cleanup() { rm -rf "$1"; }

echo "Testing appimage-webkit-fix.sh XDG_DATA_DIRS fix"
echo ""

# --- Test 1: Script exits cleanly when XDG_DATA_DIRS is unset (core Wayland fix) ---
appdir="$(setup_appdir)"
if env -u XDG_DATA_DIRS bash "$appdir/appimage-webkit-fix.sh" >/dev/null 2>&1; then
    pass "exits cleanly with XDG_DATA_DIRS unset (Wayland scenario)"
else
    fail "aborted with XDG_DATA_DIRS unset — fix not working"
fi
cleanup "$appdir"

# --- Test 2: XDG_DATA_DIRS receives a sane default when unset ---
appdir="$(setup_appdir)"
cat > "$appdir/usr/bin/jean" <<'EOF'
#!/usr/bin/env bash
echo "$XDG_DATA_DIRS"
EOF
result="$(env -u XDG_DATA_DIRS bash "$appdir/appimage-webkit-fix.sh" 2>/dev/null)"
if echo "$result" | grep -q "/usr/share"; then
    pass "XDG_DATA_DIRS contains /usr/share when originally unset"
else
    fail "XDG_DATA_DIRS missing /usr/share: '$result'"
fi
cleanup "$appdir"

# --- Test 3: AppImage share dir is prepended to XDG_DATA_DIRS ---
appdir="$(setup_appdir)"
cat > "$appdir/usr/bin/jean" <<'EOF'
#!/usr/bin/env bash
echo "$XDG_DATA_DIRS"
EOF
result="$(env -u XDG_DATA_DIRS bash "$appdir/appimage-webkit-fix.sh" 2>/dev/null)"
if echo "$result" | grep -q "$appdir/usr/share"; then
    pass "AppImage usr/share is prepended to XDG_DATA_DIRS"
else
    fail "AppImage usr/share not found in XDG_DATA_DIRS: '$result'"
fi
cleanup "$appdir"

# --- Test 4: Pre-existing XDG_DATA_DIRS is preserved ---
appdir="$(setup_appdir)"
cat > "$appdir/usr/bin/jean" <<'EOF'
#!/usr/bin/env bash
echo "$XDG_DATA_DIRS"
EOF
result="$(XDG_DATA_DIRS=/custom/share bash "$appdir/appimage-webkit-fix.sh" 2>/dev/null)"
if echo "$result" | grep -q "/custom/share"; then
    pass "pre-existing XDG_DATA_DIRS value is preserved in final path"
else
    fail "pre-existing XDG_DATA_DIRS was lost: '$result'"
fi
cleanup "$appdir"

# --- Test 5: AppImage share dir comes before pre-existing dirs ---
appdir="$(setup_appdir)"
cat > "$appdir/usr/bin/jean" <<'EOF'
#!/usr/bin/env bash
echo "$XDG_DATA_DIRS"
EOF
result="$(XDG_DATA_DIRS=/custom/share bash "$appdir/appimage-webkit-fix.sh" 2>/dev/null)"
appdir_pos=$(echo "$result" | grep -bo "$appdir/usr/share" | head -1 | cut -d: -f1)
custom_pos=$(echo "$result" | grep -bo "/custom/share" | head -1 | cut -d: -f1)
if [ -n "$appdir_pos" ] && [ -n "$custom_pos" ] && [ "$appdir_pos" -lt "$custom_pos" ]; then
    pass "AppImage share dir precedes pre-existing dirs in XDG_DATA_DIRS"
else
    fail "Ordering wrong — appdir_pos=$appdir_pos custom_pos=$custom_pos in: '$result'"
fi
cleanup "$appdir"

# --- Summary ---
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
