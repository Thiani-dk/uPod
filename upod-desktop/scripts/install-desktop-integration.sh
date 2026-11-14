#!/usr/bin/env bash
# scripts/install-desktop-integration.sh
# Puts uPod in the desktop: an app icon you can click, and a upod://
# handler so a link from the browser reaches the quality picker.
#
# Android had a launcher icon and a share sheet. A laptop has an
# application menu and nothing resembling a share intent, so this
# installs the .desktop entry that covers both, plus the app's own logo
# as a proper themed icon rather than the generic speaker glyph.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/upod.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor"
ELECTRON="$APP_DIR/node_modules/.bin/electron"

# The logo, at the sizes an icon theme actually looks for. Generated from
# ../assets/icon-only.png (the same artwork the Android launcher icon
# comes from) by scripts/make-icons.py, and committed under build/icons
# so installing needs no image tooling on the machine.
mkdir -p "$ICON_DIR"
for size in 16 24 32 48 64 128 256 512; do
  src="$APP_DIR/build/icons/$size.png"
  [ -f "$src" ] || continue
  mkdir -p "$ICON_DIR/${size}x${size}/apps"
  cp "$src" "$ICON_DIR/${size}x${size}/apps/upod.png"
done
gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true

mkdir -p "$DESKTOP_DIR"

# Both paths are quoted: this project lives under "vibe coding", and an
# unquoted space in Exec= makes the launcher run "/home/.../vibe" with
# "coding/uPod/..." as an argument — i.e. nothing happens when you click
# the icon or a upod:// link.
#
# --no-sandbox because Electron's chrome-sandbox helper must be owned by
# root with mode 4755, which npm can't do on install. To drop this flag,
# run once:
#   sudo chown root:root "$APP_DIR/node_modules/electron/dist/chrome-sandbox"
#   sudo chmod 4755 "$APP_DIR/node_modules/electron/dist/chrome-sandbox"
# then delete --no-sandbox from this file's Exec line and re-run this
# script. The app only ever loads its own local files, so the sandbox
# buys little here, but it is one command to have it back.
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=uPod
GenericName=Music Player
Comment=Your music, on the laptop
Exec="$ELECTRON" --no-sandbox "$APP_DIR" %u
Icon=upod
Terminal=false
StartupNotify=true
Categories=AudioVideo;Audio;Player;
Keywords=music;player;podcast;youtube;download;
MimeType=x-scheme-handler/upod;
StartupWMClass=uPod
EOF

chmod +x "$DESKTOP_FILE"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
xdg-mime default upod.desktop x-scheme-handler/upod 2>/dev/null || true

echo "Installed $DESKTOP_FILE"
# --- Ctrl+Alt+U -------------------------------------------------------------
# Electron's own globalShortcut is an X11 key grab, and no application can
# grab a key on Wayland — it registers happily and never fires. Under
# GNOME the compositor has to own the binding, so it is registered here as
# a custom keybinding that opens `upod://clipboard`; the running app reads
# the clipboard itself and opens the quality picker (see handleDeepLink in
# electron/main.cjs). On an X11 session the app keeps its own shortcut and
# this is skipped, so the key is never bound twice.
HOTKEY_NAME="uPod — download copied link"
HOTKEY_BINDING="<Control><Alt>u"
HOTKEY_COMMAND="\"$ELECTRON\" --no-sandbox \"$APP_DIR\" upod://clipboard"

if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && command -v gsettings >/dev/null 2>&1; then
  ROOT="org.gnome.settings-daemon.plugins.media-keys"
  CUSTOM_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/upod/"
  LIST="$(gsettings get "$ROOT" custom-keybindings 2>/dev/null || echo "@as []")"

  # Idempotent: re-running must not stack duplicate entries.
  if [ "$LIST" = "@as []" ] || [ "$LIST" = "[]" ]; then
    gsettings set "$ROOT" custom-keybindings "['$CUSTOM_PATH']"
  elif ! printf '%s' "$LIST" | grep -q "$CUSTOM_PATH"; then
    gsettings set "$ROOT" custom-keybindings "${LIST%]}, '$CUSTOM_PATH']"
  fi

  # gsettings parses its argument as a GVariant, not as a plain string, so
  # the value has to arrive already quoted — and the command contains both
  # double quotes (the paths, which hold a space) and potentially a
  # single quote, which is escaped here.
  SCHEMA="$ROOT.custom-keybinding:$CUSTOM_PATH"
  gsettings set "$SCHEMA" name "'${HOTKEY_NAME//\'/\\\'}'"
  gsettings set "$SCHEMA" command "'${HOTKEY_COMMAND//\'/\\\'}'"
  gsettings set "$SCHEMA" binding "'${HOTKEY_BINDING//\'/\\\'}'"
  echo "Bound Ctrl+Alt+U in GNOME (Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts)"
fi

echo "Installed the uPod icon into $ICON_DIR"
echo
echo "uPod is now in your application menu — search 'uPod', or pin it to"
echo "the dock/favourites, and click to launch."
echo
echo "To send it a video (uPod has to be running):"
echo
echo "  * Copy the link, then press Ctrl+Alt+U from anywhere."
echo
echo "  * Or make a browser bookmark with this as its URL, and click it"
echo "    on any YouTube page:"
echo
echo "      javascript:location.href='upod://download?url='+encodeURIComponent(location.href)"
