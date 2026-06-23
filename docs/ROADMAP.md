# Roadmap

## Phase 1 — Engine (this delivery) — COMPLETE

- [x] CEP panel UI (search, category chips, favorites tab, settings tab)
- [x] Effect database (`data/effects-index.json`) + persistence layer (`db.js`)
- [x] Search indexing (`search.js`) — inverted index, ranked results
- [x] Favorites — persisted to `favorites.json`, verified to survive reload
- [x] Settings panel — persisted to `settings.json`
- [x] Error logging — persisted to `error-log.json`, viewable in-panel
- [x] Asset validation — flags missing thumbnail/preview/preset per effect
- [x] Preset apply pipeline (`hostscript.jsx`) — real AE effect matchNames,
      property values, transform expressions, opacity keyframes
- [x] Automatic adjustment-layer creation (full-frame solid, `.adjustmentLayer = true`)
- [x] Double-click-to-apply workflow
- [x] Autoplaying, looping preview videos
- [x] 5 seed effects across 5 categories (Transitions, Glitches, Shakes, CRT, Color)
- [x] Install scripts (macOS/Linux + Windows), build/package script
- [x] Automated test harness exercising the real db/search/settings modules

## Phase 2 — Library expansion + Preview Generator

- [x] **Preview Generator built** (`tools/PreviewGenerator.jsx`): scans
      `tools/pending-presets/*.json`, applies the effect chain to a
      duplicated template comp, renders a preview via the Render Queue,
      grabs a thumbnail via native `saveFrameToPng`, appends to
      `effects-index.json`, and files the processed definition away.
      Wired into the panel as a "Generate previews for pending effects"
      button in Settings, plus a "Rescan library" button that picks up new
      effects without restarting AE.
      **Caveat:** the Render Queue / Output Module step could not be
      executed end-to-end in the sandbox that built this (no AE install
      available there) - the effect-chain application logic is shared
      with the already-proven `fx_applyPreset`, but the render step itself
      needs verification on a real machine. See
      `tools/pending-presets/README.md` for setup and what to check if it
      reports an output-template error.
- [x] Expand to the full 20+ effect MVP list - 15 new presets written and
      validated in `tools/pending-presets/`, completing all 5 original
      categories to 4 effects each. They become real (rendered preview +
      registered) effects once you run them through the Preview Generator
      on a machine with AE.
- [x] **Bug fix discovered while expanding the library:** the original
      shake-family effects (and Zoom Transition's design) drove the
      *adjustment layer's own transform* with expressions/keyframes. An
      adjustment layer with no actual effect in its chain can render as a
      no-op, so this was unreliable. Fixed by routing shake/zoom through a
      real `ADBE Geometry2` (Transform) effect instead - this required
      adding expression support for effect properties (previously only
      transform properties supported expressions). `micro-shake` (already
      shipped) was patched in place; needs re-testing in AE to confirm.
- [x] **Split Screen category added** (`presetType: "layout"`) - a
      genuinely different mechanism from every other effect: instead of
      adding an adjustment layer, it takes your currently-selected layers
      and arranges them into 2/3/4 panel grids (vertical, horizontal, or
      2x2). New `fx_applySplitScreen()` host function, with diagram-style
      thumbnails (no preview video, since it's a layout tool not a look).
      **Untested in real AE** - the masking/scaling math is logic-checked
      but not render-verified.
- [x] **Real bug fix:** `applyEffect()` in the panel was unconditionally
      calling `fx_applyPreset` regardless of an effect's `presetType` -
      meaning imported `.ffx` presets would silently do nothing on
      double-click instead of calling `fx_applyFfxPreset`. Fixed with
      proper branching by presetType (scripted / ffx / layout).
- [ ] Real `.ffx` exports for effects where exact match-frame fidelity to a
      hand-built AE project matters more than the scripted-chain approach
      (Phase 1's `fx_applyFfxPreset()` already supports this - just needs
      the `.ffx` files themselves, exported once from AE).
- [ ] Animated (not static) RGB channel-split offsets via expressions on the
      Shift Channels effect, replacing the Phase 1 static offset + layer wiggle.
- [ ] Per-effect adjustable parameters in the UI before apply (e.g. shake
      intensity slider) rather than fixed values.
- [ ] Real rendered previews for Split Screen (currently diagram thumbnails
      only - would need sample footage with genuinely different content per
      panel to render meaningfully, which the current single-sample-footage
      Preview Generator pipeline doesn't support yet).
- [x] **Apply Mode added** (Settings > Apply mode): "Keyframed" plays an
      effect's built-in animation at its normal length (the existing
      default behavior). "Constant" holds every effect property at a
      single static value (no animation, no expressions) and stretches the
      adjustment layer to match the full remaining length of whatever
      layer is selected when you double-click - useful for a color grade
      or steady look that should run the whole clip instead of a short
      burst. Implemented in the shared `fx_pg_applyChainToLayer` so it
      works identically whether applied via double-click or generated
      through the Preview Generator.

## Phase 3 — Polish & distribution

- [ ] Code-signing certificate + signed `.zxp` packaging (removes the
      PlayerDebugMode requirement for end users)
- [ ] Version update checker (the `checkForUpdatesOnLaunch` setting exists
      already but is intentionally inert/disabled — no network calls are
      wired up yet; needs a hosted manifest endpoint before enabling)
- [ ] Drag-and-drop apply (in addition to double-click)
- [ ] Bulk asset re-validation / "repair" flow that re-triggers the Preview
      Generator for specific broken effects from inside the panel

## UXP migration (tracked, not started)

CEP is the right foundation today because AE's UXP panel + ExtendScript
bridge support is still immature/inconsistent across AE versions. Revisit
this once Adobe ships stable UXP panel support with a documented scripting
bridge for After Effects specifically (not just Photoshop/InDesign). When
that happens:

- The `js/` UI logic (db, search, settings, logger) is largely portable —
  it only depends on `fs`/`path`, which UXP also exposes (with permission
  scoping that doesn't exist in CEP, so paths will need adjusting).
- `hostscript.jsx` and the entire `evalScript` bridge would need to be
  rewritten against whatever AE's native UXP scripting surface ends up
  being, since UXP does not support arbitrary `evalScript`-style ExtendScript
  execution by design.
