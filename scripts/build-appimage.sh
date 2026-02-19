#!/usr/bin/env bash
# Build AppImage with WebKitGTK compatibility fix for rolling-release distros.
#
# The default AppImage bundles libraries from Ubuntu 22.04 which conflict
# with newer system libraries on Arch Linux, Fedora 40+, etc. This script:
# 1. Builds the AppImage normally via Tauri
# 2. Replaces AppRun with a custom script that prefers system WebKitGTK
# 3. Repackages the AppImage
#
# Usage: bash scripts/build-appimage.sh
#
# Related issues:
# - https://github.com/coollabsio/jean/issues/52
# - https://github.com/coollabsio/jean/issues/55
# - https://github.com/coollabsio/jean/issues/71

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_DIR="$PROJECT_DIR/src-tauri/target/release/bundle/appimage"
APPDIR="$BUNDLE_DIR/Jean.AppDir"
CUSTOM_APPRUN="$SCRIPT_DIR/appimage-webkit-fix.sh"

echo "==> Building AppImage via Tauri..."
cd "$PROJECT_DIR"
NO_STRIP=true tauri build --bundles appimage 2>&1 || {
    echo "Tauri build failed, trying manual linuxdeploy fallback..."
    cd "$BUNDLE_DIR"
    NO_STRIP=1 ~/.cache/tauri/linuxdeploy-x86_64.AppImage --appdir Jean.AppDir --output appimage
}

if [ ! -d "$APPDIR" ]; then
    echo "ERROR: AppDir not found at $APPDIR"
    exit 1
fi

if [ ! -f "$CUSTOM_APPRUN" ]; then
    echo "ERROR: Custom AppRun script not found at $CUSTOM_APPRUN"
    exit 1
fi

echo "==> Replacing AppRun with WebKitGTK compatibility fix..."
cp "$APPDIR/AppRun" "$APPDIR/AppRun.original"
cp "$CUSTOM_APPRUN" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"

echo "==> Repackaging AppImage..."
cd "$BUNDLE_DIR"

# Remove the old AppImage files
rm -f Jean_*_amd64.AppImage Jean-x86_64.AppImage

ARCH=x86_64 ~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage --appdir Jean.AppDir 2>&1

# Rename to standard naming convention
if [ -f "Jean-x86_64.AppImage" ]; then
    VERSION=$(grep '"version"' "$PROJECT_DIR/src-tauri/tauri.conf.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
    FINAL_NAME="Jean_${VERSION}_amd64.AppImage"
    mv "Jean-x86_64.AppImage" "$FINAL_NAME"
    echo "==> AppImage built successfully: $BUNDLE_DIR/$FINAL_NAME"
else
    echo "ERROR: Repackaging failed"
    exit 1
fi
