#!/usr/bin/env bash
# scripts/sync-from-phone.sh
# Pulls the phone's music folder into the desktop library. Safe to re-run:
# adb pull overwrites by name, so this is a top-up rather than a
# duplicate. Needs USB debugging on and the phone plugged in.
set -euo pipefail

PHONE_DIR="/storage/emulated/0/Download/Music Downloads"
LIB_ROOT="${UPOD_LIBRARY_ROOT:-$HOME/Music/uPod}"
DEST="$LIB_ROOT/Download"

if ! command -v adb >/dev/null; then
  echo "adb isn't installed." >&2
  exit 1
fi

if [ -z "$(adb devices | sed -n '2p')" ]; then
  echo "No device. Plug the phone in and make sure USB debugging is on." >&2
  exit 1
fi

echo "Pulling \"$PHONE_DIR\" into $DEST ..."
mkdir -p "$DEST"
adb pull "$PHONE_DIR" "$DEST/Music Downloads"

COUNT=$(find "$DEST/Music Downloads" -type f \
  \( -iname '*.mp3' -o -iname '*.opus' -o -iname '*.m4a' -o -iname '*.flac' -o -iname '*.ogg' \) | wc -l)
echo "Done — $COUNT audio files in the desktop library."
