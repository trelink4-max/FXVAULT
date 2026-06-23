#!/usr/bin/env bash
# FXVault installer (macOS / Linux)
#
# Copies this extension into Adobe's CEP extensions folder and enables CEP
# debug mode (required to load an unsigned extension during development).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_NAME="com.fxvault.panel2"

if [[ "$OSTYPE" == "darwin"* ]]; then
  TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_NAME"
  PLIST="$HOME/Library/Preferences/com.adobe.CSXS.9.plist"
  echo "Detected macOS."
  echo "Installing to: $TARGET"
  mkdir -p "$(dirname "$TARGET")"
  rm -rf "$TARGET"
  cp -R "$SCRIPT_DIR" "$TARGET"
  for v in 4 5 6 6.1 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
  done
  echo "Enabled PlayerDebugMode for CSXS 4-20 (covers all known AE releases including 2026)."
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  TARGET="$HOME/.local/share/Adobe/CEP/extensions/$EXT_NAME"
  echo "Detected Linux (uncommon for After Effects, but copying anyway)."
  mkdir -p "$(dirname "$TARGET")"
  rm -rf "$TARGET"
  cp -R "$SCRIPT_DIR" "$TARGET"
  echo "NOTE: enable PlayerDebugMode manually via the registry-equivalent for your AE build."
else
  echo "Unrecognized OS ($OSTYPE). Use install.bat on Windows, or copy the folder manually:"
  echo "  macOS:   ~/Library/Application Support/Adobe/CEP/extensions/$EXT_NAME"
  echo "  Windows: %APPDATA%\\Adobe\\CEP\\extensions\\$EXT_NAME"
  exit 1
fi

echo ""
echo "Done. Restart After Effects, then open: Window > Extensions > FXVault"
