#!/usr/bin/env bash
# FXVault build script
# Validates JSON/JS, runs the asset existence check, then produces a zipped
# build artifact under dist/. Does not require AE - this only packages the
# extension; running it is still required to verify in-app behavior.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/../dist"
VERSION=$(python3 -c "import json; print(json.load(open('$ROOT_DIR/data/version.json'))['currentVersion'])" 2>/dev/null || echo "0.1.0")

echo "== FXVault build =="
echo "Source: $ROOT_DIR"
echo "Version: $VERSION"

echo ""
echo "-- Validating JSON files --"
for f in "$ROOT_DIR"/data/*.json; do
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" && echo "  OK   $f" || { echo "  FAIL $f"; exit 1; }
done

echo ""
echo "-- Validating JS syntax --"
for f in "$ROOT_DIR"/js/*.js; do
  node --check "$f" && echo "  OK   $f" || { echo "  FAIL $f"; exit 1; }
done

echo ""
echo "-- Checking required files --"
required=(
  "CSXS/manifest.xml"
  "index.html"
  "jsx/hostscript.jsx"
  "data/effects-index.json"
)
for f in "${required[@]}"; do
  if [ -f "$ROOT_DIR/$f" ]; then
    echo "  OK   $f"
  else
    echo "  MISSING $f"
    exit 1
  fi
done

echo ""
echo "-- Checking effect assets --"
python3 << PYEOF
import json, os
root = "$ROOT_DIR"
data = json.load(open(os.path.join(root, "data", "effects-index.json")))
missing = []
for fx in data["effects"]:
    for key in ("thumbnail", "preview"):
        val = fx.get(key)
        if val is None:
            continue  # valid for layout-type effects (e.g. Split Screen) which have no preview video
        p = os.path.join(root, val)
        if not os.path.exists(p):
            missing.append(p)
if missing:
    print("  MISSING ASSETS:")
    for m in missing:
        print("   -", m)
    raise SystemExit(1)
else:
    print("  OK   all", len(data["effects"]), "effects have thumbnail + preview")
PYEOF

echo ""
echo "-- Packaging --"
mkdir -p "$DIST_DIR"
ZIP_NAME="fxvault-$VERSION.zip"
rm -f "$DIST_DIR/$ZIP_NAME"
cd "$ROOT_DIR/.."
zip -r -q "$DIST_DIR/$ZIP_NAME" "$(basename "$ROOT_DIR")" \
  -x "*/node_modules/*" -x "*/.git/*" -x "*/dist/*"
echo "  Wrote $DIST_DIR/$ZIP_NAME"

echo ""
echo "Build complete. This validates structure and packages the extension -"
echo "it does NOT substitute for opening the panel inside After Effects."
