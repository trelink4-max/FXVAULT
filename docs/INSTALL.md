# Installing FXVault

## Requirements

- Adobe After Effects 2020 (17.0) through 2025/2026, any OS CEP supports (Windows/macOS).
- CEP extensions enabled in your AE preferences (default).

## Option A — scripted install (recommended)

**macOS / Linux**
```bash
cd FXVault/scripts
chmod +x install.sh
./install.sh
```

**Windows**
```
cd FXVault\scripts
install.bat
```

This copies the extension into Adobe's CEP extensions folder and enables
`PlayerDebugMode` (required to load an unsigned/dev extension — FXVault is
not yet signed with an Adobe code-signing certificate).

## Option B — manual install

1. Copy the entire `FXVault` folder to:
   - **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/com.fxvault.panel`
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\com.fxvault.panel`
2. Enable debug mode for unsigned extensions:
   - **macOS** (Terminal):
     ```bash
     defaults write com.adobe.CSXS.9 PlayerDebugMode 1
     defaults write com.adobe.CSXS.10 PlayerDebugMode 1
     defaults write com.adobe.CSXS.11 PlayerDebugMode 1
     ```
   - **Windows** (Registry):
     Add a string value `PlayerDebugMode` = `1` under
     `HKEY_CURRENT_USER\Software\Adobe\CSXS.9` (and `.10`, `.11` for newer AE).
3. Restart After Effects.

> The CSXS version number corresponds to your AE release. AE 2020-2021 ≈
> CSXS 9-10, AE 2022+ ≈ CSXS 11+. The scripts set all three to be safe.

## Opening the panel

`Window > Extensions > FXVault`

If FXVault doesn't appear in that menu:
- Confirm the folder landed at the exact path above (`com.fxvault.panel`,
  containing `CSXS/manifest.xml` at its root).
- Confirm debug mode is enabled for the CSXS version matching your AE build.
- Fully quit and relaunch After Effects (not just close/reopen the panel).

## Verifying it's working (Phase 1 checklist)

1. Open the panel. You should see 5 effect cards across 5 categories, each
   with an autoplaying, looping preview.
2. Type into the search box — the grid should filter live.
3. Click a category chip — the grid should filter to that category.
4. Click the star on a card — it should fill in immediately, and persist
   if you close/reopen the panel.
5. Open or create a composition, then **double-click** a card. After Effects
   should create a new adjustment layer at the playhead with the effect's
   look applied.
6. Open the gear icon (Settings tab). Toggle autoplay/loop, save, and
   confirm the grid behavior changes accordingly.
7. In Settings, check the error log section — it should show an "FXVault
   booted" info entry from this session.

If any step fails, see `docs/QUALITY-CHECK.md` for the specific thing to
check, and the Settings > error log for diagnostic detail.

## Uninstalling

Delete the extension folder from the CEP extensions path listed above, then
restart After Effects. PlayerDebugMode can be left on — it only affects
loading of unsigned extensions, not AE's normal operation.
