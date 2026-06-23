// FXVault hostscript.jsx
// Runs inside After Effects' ExtendScript engine. Every exported function
// returns a JSON string of the form {success: bool, message?: string, data?: any}
// so the panel-side JS never has to guess what happened.

#include "json2-polyfill.jsx"
#include "../tools/PreviewGenerator.jsx"

function fx_ok(data) {
  return JSON.stringify({ success: true, data: data || null });
}

function fx_fail(message) {
  return JSON.stringify({ success: false, message: String(message) });
}

/**
 * Returns basic info about the active composition, or success:false if
 * there isn't one. The panel calls this to enable/disable "apply" actions
 * and to show the user why apply might be unavailable.
 */
function fx_getActiveCompInfo() {
  try {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }
    return fx_ok({
      name: comp.name,
      width: comp.width,
      height: comp.height,
      duration: comp.duration,
      frameRate: comp.frameRate,
      currentTime: comp.time
    });
  } catch (e) {
    return fx_fail("fx_getActiveCompInfo error: " + e.toString());
  }
}

/**
 * Creates a full-frame adjustment layer named per the preset, applies the
 * preset's effect chain (by matchName) and any transform expressions /
 * opacity keyframes, and returns the resulting layer name + index.
 *
 * payloadJson shape (see data/effects-index.json for full schema):
 * {
 *   name, adjustmentLayer: {durationSeconds, name},
 *   effectChain: [{matchName, properties: [{name, value}]}],
 *   transformExpressions: {Position?, Rotation?, Opacity?, Scale?},
 *   transformKeyframes: {Opacity?: [{timeOffset, value}, ...]}
 * }
 */
function fx_applyPreset(payloadJson) {
  try {
    var payload = JSON.parse(payloadJson);

    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }

    app.beginUndoGroup("FXVault: Apply " + (payload.name || "Preset"));

    var durationSeconds = (payload.adjustmentLayer && payload.adjustmentLayer.durationSeconds) || 1.0;
    var layerName = (payload.adjustmentLayer && payload.adjustmentLayer.name) || payload.name || "FXVault Layer";

    if (payload.applyMode === "constant") {
      // "Constant" means: hold the effect with no animation, and stretch the
      // adjustment layer to match the full remaining length of whatever clip
      // is selected (falling back to the rest of the comp if nothing is
      // selected), rather than the preset's short default burst duration.
      var selectedLayers = comp.selectedLayers;
      if (selectedLayers && selectedLayers.length > 0) {
        var targetLayer = selectedLayers[0];
        durationSeconds = targetLayer.outPoint - comp.time;
      } else {
        durationSeconds = comp.duration - comp.time;
      }
      if (durationSeconds <= 0) durationSeconds = 1.0; // guard against a degenerate selection/playhead position
    }

    // Real AE API: adjustment layers are solids with .adjustmentLayer = true.
    var solidColor = [1, 1, 1];
    var newLayer = comp.layers.addSolid(solidColor, layerName, comp.width, comp.height, comp.pixelAspect, durationSeconds);
    newLayer.adjustmentLayer = true;
    newLayer.startTime = comp.time;
    newLayer.moveToBeginning();

    // --- Effect chain, transform expressions, and transform keyframes ---
    // Shared with the Preview Generator (tools/PreviewGenerator.jsx) so the
    // two code paths can never drift apart in behavior.
    var appliedEffects = fx_pg_applyChainToLayer(newLayer, payload, comp.time);

    app.endUndoGroup();

    return fx_ok({
      layerName: newLayer.name,
      layerIndex: newLayer.index,
      appliedEffects: appliedEffects
    });
  } catch (e) {
    try { app.endUndoGroup(); } catch (ignore) {}
    return fx_fail("fx_applyPreset error: " + e.toString());
  }
}

/**
 * Applies a real .ffx preset file via AE's native applyPreset(), for effects
 * whose presetType is "ffx" rather than "scripted". Creates the same kind of
 * full-frame adjustment layer first, then applies the preset file to it.
 */
function fx_applyFfxPreset(layerNameArg, ffxAbsolutePath, durationSecondsArg) {
  try {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }

    var presetFile = new File(ffxAbsolutePath);
    if (!presetFile.exists) {
      return fx_fail("Preset file not found on disk: " + ffxAbsolutePath);
    }

    app.beginUndoGroup("FXVault: Apply " + layerNameArg);

    var durationSeconds = durationSecondsArg || 1.0;
    var newLayer = comp.layers.addSolid([1, 1, 1], layerNameArg, comp.width, comp.height, comp.pixelAspect, durationSeconds);
    newLayer.adjustmentLayer = true;
    newLayer.startTime = comp.time;
    newLayer.moveToBeginning();

    newLayer.applyPreset(presetFile);

    app.endUndoGroup();
    return fx_ok({ layerName: newLayer.name, layerIndex: newLayer.index });
  } catch (e) {
    try { app.endUndoGroup(); } catch (ignore) {}
    return fx_fail("fx_applyFfxPreset error: " + e.toString());
  }
}

/**
 * Panel-facing wrapper for the Preview Generator. The panel doesn't know its
 * own install path from the ExtendScript side, so this resolves it the same
 * way fx_getProjectInfo's siblings do, then delegates to fx_runPreviewGenerator
 * (defined in tools/PreviewGenerator.jsx, included above).
 */
function fx_runPreviewGeneratorFromPanel() {
  try {
    var thisFile = new File($.fileName); // hostscript.jsx itself
    var extensionRoot = thisFile.parent.parent.fsName; // jsx/ -> extension root
    return fx_runPreviewGenerator(extensionRoot);
  } catch (e) {
    return JSON.stringify({ success: false, message: "fx_runPreviewGeneratorFromPanel error: " + e.toString() });
  }
}
/**
 * Split Screen layout handler.
 *
 * Unlike every other preset type, this does NOT add an adjustment layer -
 * it takes the layers you already have SELECTED in the comp (in their
 * current stacking order) and arranges them into a grid: masks each one to
 * its panel and scales+positions it to fill that panel, mimicking the
 * manual duplicate-mask-position workflow editors already do for split-
 * screen edits.
 *
 * paramsJson shape:
 * { "divisions": 3, "orientation": "vertical" }   // vertical = side-by-side columns
 * { "divisions": 4, "orientation": "grid" }        // 2x2 grid (divisions must be 4 for grid)
 *
 * Requires exactly `divisions` layers selected (in top-to-bottom order,
 * which becomes left-to-right / top-to-bottom panel order). Returns a
 * clear error telling you exactly how many layers you selected vs needed,
 * rather than guessing or silently doing the wrong thing.
 */
function fx_applySplitScreen(paramsJson) {
  try {
    var params = JSON.parse(paramsJson);
    var divisions = params.divisions;
    var orientation = params.orientation || "vertical"; // "vertical" | "horizontal" | "grid"

    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length !== divisions) {
      return fx_fail(
        "Split " + divisions + " " + orientation + " needs exactly " + divisions +
        " selected layers (top-to-bottom = panel order left-to-right / top-to-bottom). " +
        "You have " + (selected ? selected.length : 0) + " selected."
      );
    }

    app.beginUndoGroup("FXVault: Split Screen " + divisions + " " + orientation);

    var W = comp.width, H = comp.height;
    var panels = [];

    if (orientation === "grid" && divisions === 4) {
      var halfW = W / 2, halfH = H / 2;
      panels = [
        { x: 0, y: 0, w: halfW, h: halfH },
        { x: halfW, y: 0, w: halfW, h: halfH },
        { x: 0, y: halfH, w: halfW, h: halfH },
        { x: halfW, y: halfH, w: halfW, h: halfH }
      ];
    } else if (orientation === "horizontal") {
      var rowH = H / divisions;
      for (var r = 0; r < divisions; r++) panels.push({ x: 0, y: r * rowH, w: W, h: rowH });
    } else { // vertical (default) - side-by-side columns
      var colW = W / divisions;
      for (var c = 0; c < divisions; c++) panels.push({ x: c * colW, y: 0, w: colW, h: H });
    }

    // selectedLayers is ordered by stacking position (topmost first), which
    // we treat as the intended left-to-right / top-to-bottom panel order.
    var results = [];
    for (var i = 0; i < selected.length; i++) {
      var layer = selected[i];
      var panel = panels[i];
      try {
        // Scale-to-fill: match the panel's aspect ratio by scaling uniformly
        // to whichever dimension is the tighter fit, then center-crop via mask.
        var srcW = layer.source ? layer.source.width : W;
        var srcH = layer.source ? layer.source.height : H;
        var scale = Math.max(panel.w / srcW, panel.h / srcH) * 100;

        layer.transform.scale.setValue([scale, scale]);
        layer.transform.position.setValue([panel.x + panel.w / 2, panel.y + panel.h / 2]);

        // Rectangular mask clipping the (now panel-filling) layer to its panel bounds.
        var maskGroup = layer.property("ADBE Mask Parade");
        var mask = maskGroup.addProperty("ADBE Mask Atom");
        var shape = mask.property("ADBE Mask Shape").value;
        shape.vertices = [
          [panel.x, panel.y],
          [panel.x + panel.w, panel.y],
          [panel.x + panel.w, panel.y + panel.h],
          [panel.x, panel.y + panel.h]
        ];
        shape.closed = true;
        mask.property("ADBE Mask Shape").setValue(shape);

        results.push({ layerName: layer.name, panel: i, applied: true });
      } catch (layerErr) {
        results.push({ layerName: layer.name, panel: i, applied: false, error: layerErr.toString() });
      }
    }

    app.endUndoGroup();
    return fx_ok({ divisions: divisions, orientation: orientation, results: results });
  } catch (e) {
    try { app.endUndoGroup(); } catch (ignore) {}
    return fx_fail("fx_applySplitScreen error: " + e.toString());
  }
}

/**
 * Time Remap handler - Reverse and Speed Ramps.
 *
 * Unlike scripted/ffx/layout presets, this manipulates the SELECTED layer's
 * own time properties directly (Time-Reverse Layer command, or keyframed
 * Time Remapping) rather than adding an adjustment layer or arranging
 * layers into panels.
 *
 * paramsJson shape:
 * { "action": "reverse" }
 * { "action": "speedramp", "style": "slow-fast" | "fast-slow" | "freeze-punch" }
 */
function fx_applyTimeRemap(paramsJson) {
  try {
    var params = JSON.parse(paramsJson);
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length === 0) {
      return fx_fail("Select the layer(s) you want to " + params.action + " first, then double-click.");
    }

    app.beginUndoGroup("FXVault: " + params.action);
    var results = [];

    for (var i = 0; i < selected.length; i++) {
      var layer = selected[i];
      try {
        if (params.action === "reverse") {
          // AE's native Time-Reverse Layer command - more reliable than
          // manually setting negative stretch (handles audio correctly too).
          layer.selected = true;
          var cmdId = app.findMenuCommandId("Time-Reverse Layer");
          if (!cmdId) throw new Error("Could not find the 'Time-Reverse Layer' menu command on this AE version/locale.");
          app.executeCommand(cmdId);
          results.push({ layerName: layer.name, applied: true });

        } else if (params.action === "speedramp") {
          layer.timeRemapEnabled = true;
          var trp = layer.property("ADBE Time Remapping");
          var dur = layer.outPoint - layer.inPoint;
          var t0 = layer.inPoint, t1 = layer.outPoint;
          var style = params.style || "slow-fast";

          // Clear any existing keyframes this enable-call may have seeded.
          while (trp.numKeys > 0) trp.removeKey(1);

          if (style === "slow-fast") {
            // Starts slow (holds early source time), ramps to full speed.
            trp.setValueAtTime(t0, t0);
            trp.setValueAtTime(t0 + dur * 0.6, t0 + dur * 0.15);
            trp.setValueAtTime(t1, t1);
          } else if (style === "fast-slow") {
            // Starts fast, eases into a slow finish.
            trp.setValueAtTime(t0, t0);
            trp.setValueAtTime(t0 + dur * 0.4, t0 + dur * 0.85);
            trp.setValueAtTime(t1, t1);
          } else { // freeze-punch: hold on first frame, then snap to full speed
            trp.setValueAtTime(t0, t0);
            trp.setValueAtTime(t0 + dur * 0.5, t0);
            trp.setValueAtTime(t1, t1);
          }

          // Ease every keyframe for a smooth ramp rather than a linear one.
          for (var k = 1; k <= trp.numKeys; k++) {
            try {
              var ease = new KeyframeEase(0, 75);
              trp.setTemporalEaseAtKey(k, [ease], [ease]);
            } catch (easeErr) { /* non-fatal - keyframes still work without eased interpolation */ }
          }

          results.push({ layerName: layer.name, applied: true, style: style });
        } else {
          results.push({ layerName: layer.name, applied: false, error: "Unknown action: " + params.action });
        }
      } catch (layerErr) {
        results.push({ layerName: layer.name, applied: false, error: layerErr.toString() });
      }
    }

    app.endUndoGroup();
    return fx_ok({ action: params.action, results: results });
  } catch (e) {
    try { app.endUndoGroup(); } catch (ignore) {}
    return fx_fail("fx_applyTimeRemap error: " + e.toString());
  }
}

/**
 * Random Flicker handler.
 *
 * Punches a short effect chain (default: B&W desaturation) into N randomly
 * placed, randomly-sized time windows across the selected layer's duration -
 * e.g. "go black and white on random clips for a random number of frames."
 * Each window gets its own small adjustment layer holding the same effect
 * chain, reusing fx_pg_applyChainToLayer so the actual look-application
 * logic is identical to every other preset - only the TIMING is randomized.
 *
 * paramsJson shape:
 * {
 *   "effectChain": [...],                 // same schema as scripted presets
 *   "occurrences": 5,                     // how many random hits
 *   "minDurationFrames": 2,
 *   "maxDurationFrames": 6
 * }
 */
function fx_applyRandomFlicker(paramsJson) {
  try {
    var params = JSON.parse(paramsJson);
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return fx_fail("No active composition. Open or select a composition first.");
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length === 0) {
      return fx_fail("Select the layer(s) you want the random hits applied to, then double-click.");
    }

    app.beginUndoGroup("FXVault: Random Flicker");

    var frameDur = 1 / comp.frameRate;
    var occurrences = params.occurrences || 5;
    var minDur = (params.minDurationFrames || 2) * frameDur;
    var maxDur = (params.maxDurationFrames || 6) * frameDur;
    var results = [];

    for (var L = 0; L < selected.length; L++) {
      var targetLayer = selected[L];
      var spanStart = targetLayer.inPoint;
      var spanEnd = targetLayer.outPoint;
      var spanLen = spanEnd - spanStart;
      if (spanLen <= 0) continue;

      for (var i = 0; i < occurrences; i++) {
        var dur = minDur + Math.random() * (maxDur - minDur);
        var maxStart = spanLen - dur;
        if (maxStart <= 0) continue;
        var start = spanStart + Math.random() * maxStart;

        try {
          var fxLayer = comp.layers.addSolid([1,1,1], "Random Hit " + (i+1), comp.width, comp.height, comp.pixelAspect, dur);
          fxLayer.adjustmentLayer = true;
          fxLayer.startTime = start;
          fxLayer.moveToBeginning();
          fx_pg_applyChainToLayer(fxLayer, { effectChain: params.effectChain, applyMode: "constant" }, start);
          results.push({ layer: targetLayer.name, start: start, duration: dur, applied: true });
        } catch (hitErr) {
          results.push({ layer: targetLayer.name, applied: false, error: hitErr.toString() });
        }
      }
    }

    app.endUndoGroup();
    return fx_ok({ results: results });
  } catch (e) {
    try { app.endUndoGroup(); } catch (ignore) {}
    return fx_fail("fx_applyRandomFlicker error: " + e.toString());
  }
}

/**
 * Returns the absolute path of the currently open project, or null, so the
 * panel can resolve relative asset paths (sample footage etc.) consistently.
 */
function fx_getProjectInfo() {
  try {
    return fx_ok({
      file: proj.file ? proj.file.fsName : null,
      numItems: proj.numItems
    });
  } catch (e) {
    return fx_fail("fx_getProjectInfo error: " + e.toString());
  }
}
