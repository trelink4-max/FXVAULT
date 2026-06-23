// FXVault Preview Generator (Phase 2)
// -------------------------------------
// Automates the manual steps we did by hand for the 5 seed effects:
//   1. Detect new presets       - scan tools/pending-presets/*.json
//   2. Apply preset to footage  - reuse the same effect-chain logic as fx_applyPreset
//   3. Render a preview clip    - via the Render Queue
//   4. Create a thumbnail       - via CompItem.saveFrameToPng (native AE API, no ffmpeg needed)
//   5. Update the database      - rewrite data/effects-index.json
//   6. Make it searchable       - automatic: the panel rebuilds its search index from
//                                  effects-index.json every time it loads, and Settings has
//                                  a "Rescan library" button to pick up new entries without
//                                  restarting AE at all.
//
// REQUIREMENTS ON YOUR MACHINE (cannot be verified from this sandbox - no AE available here):
//   - A template AE project open with a composition named exactly "PreviewComp"
//     (1280x720, at least 4 seconds long) containing a footage layer named
//     "SampleFootage". See tools/pending-presets/README.md for setup.
//   - A Render Queue Output Module template capable of writing .mp4 (H.264).
//     AE's available template *names* vary by version/install - this script tries a
//     short list of common names and falls back to listing what's actually available
//     on your machine if none match, so you can hardcode the right one.
//
// This file is #include-d by jsx/hostscript.jsx so every function here is also
// callable from the panel via evalScript, exactly like fx_applyPreset.

var FX_PENDING_DIR_NAME = "pending-presets";
var FX_PROCESSED_DIR_NAME = "processed";
var FX_TEMPLATE_COMP_NAME = "PreviewComp";
var FX_SAMPLE_LAYER_NAME = "SampleFootage";
var FX_PREVIEW_DURATION_SECONDS = 4;
var FX_OUTPUT_TEMPLATE_CANDIDATES = [
  "H.264 - Match Render Settings - 15 Mbps",
  "H.264",
  "Match Source - High bitrate"
];

function fx_pg_log(extensionRoot, message) {
  try {
    var logFile = new File(extensionRoot + "/data/preview-generator.log");
    logFile.open("a");
    logFile.writeln("[" + new Date().toISOString().split(".")[0] + "] " + message);
    logFile.close();
  } catch (e) {
    // Logging must never abort the pipeline.
  }
}

function fx_pg_readJsonFile(file) {
  file.open("r");
  var content = file.read();
  file.close();
  return JSON.parse(content);
}

function fx_pg_writeJsonFile(file, data) {
  if (file.exists) file.remove();
  file.open("w");
  file.write(JSON.stringify(data, null, 2));
  file.close();
}

/**
 * Applies an effect-chain definition (same schema as fx_applyPreset's payload)
 * to a specific layer, WITHOUT creating its own adjustment layer - the caller
 * supplies the layer. Shared by fx_applyPreset and the Preview Generator so
 * the two never drift apart in behavior.
 *
 * baseTime: the comp-time the layer's effects are considered to start at
 * (normally the layer's startTime). All keyframe timeOffsets are relative
 * to this. Defaults to layer.startTime if not supplied.
 */
function fx_pg_applyChainToLayer(layer, payload, baseTime) {
  var appliedEffects = [];
  if (baseTime === undefined || baseTime === null) baseTime = layer.startTime;
  var constantMode = payload.applyMode === "constant";

  if (payload.effectChain && payload.effectChain.length) {
    for (var i = 0; i < payload.effectChain.length; i++) {
      var effDef = payload.effectChain[i];
      var effect = null;
      try {
        effect = layer.Effects.addProperty(effDef.matchName);
      } catch (effErr) {
        appliedEffects.push({ matchName: effDef.matchName, applied: false, error: effErr.toString() });
        continue;
      }
      if (effDef.properties && effect) {
        for (var p = 0; p < effDef.properties.length; p++) {
          var propDef = effDef.properties[p];
          try {
            var prop = effect.property(propDef.name);
            if (!prop) continue;

            if (constantMode) {
              // Constant mode: hold a single static value for the whole
              // duration instead of animating - use the first keyframe's
              // value if there is one, otherwise the static value. Skip
              // expressions entirely (a "constant shake" is a contradiction -
              // it just holds still, which is the correct constant-mode result).
              if (propDef.keyframes && propDef.keyframes.length) {
                prop.setValue(propDef.keyframes[0].value);
              } else if (propDef.value !== undefined) {
                prop.setValue(propDef.value);
              }
              continue;
            }

            if (propDef.keyframes && propDef.keyframes.length) {
              // Per-property keyframes - e.g. Fill's Color cycling red->green->blue.
              for (var pk = 0; pk < propDef.keyframes.length; pk++) {
                var pkf = propDef.keyframes[pk];
                prop.setValueAtTime(baseTime + pkf.timeOffset, pkf.value);
              }
            } else if (propDef.expression) {
              // Expression-driven effect property - e.g. wiggle on a Transform
              // effect's Position, for shake/zoom looks that need to actually
              // affect the composite below (an adjustment layer's OWN transform
              // does not reliably do this - it has to be a real effect).
              prop.expression = propDef.expression;
            } else if (propDef.value !== undefined) {
              prop.setValue(propDef.value);
            }
          } catch (propErr) {
            appliedEffects.push({ matchName: effDef.matchName, property: propDef.name, applied: false, error: propErr.toString() });
          }
        }
      }
      appliedEffects.push({ matchName: effDef.matchName, applied: true });
    }
  }

  if (!constantMode && payload.transformExpressions) {
    for (var key in payload.transformExpressions) {
      if (!payload.transformExpressions.hasOwnProperty(key)) continue;
      try {
        var transformProp = layer.transform.property(key);
        if (transformProp) transformProp.expression = payload.transformExpressions[key];
      } catch (exprErr) {
        appliedEffects.push({ transformProperty: key, applied: false, error: exprErr.toString() });
      }
    }
  }

  if (payload.transformKeyframes) {
    for (var tkKey in payload.transformKeyframes) {
      if (!payload.transformKeyframes.hasOwnProperty(tkKey)) continue;
      try {
        var kfProp = layer.transform.property(tkKey);
        var kfList = payload.transformKeyframes[tkKey];
        if (constantMode) {
          // Hold the first keyframe's value statically for the whole duration.
          kfProp.setValue(kfList[0].value);
        } else {
          for (var k = 0; k < kfList.length; k++) {
            var kf = kfList[k];
            kfProp.setValueAtTime(baseTime + kf.timeOffset, kf.value);
          }
        }
      } catch (kfErr) {
        appliedEffects.push({ transformKeyframe: tkKey, applied: false, error: kfErr.toString() });
      }
    }
  }

  return appliedEffects;
}

function fx_pg_findTemplateComp() {
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof CompItem && item.name === FX_TEMPLATE_COMP_NAME) {
      return item;
    }
  }
  return null;
}

function fx_pg_pickOutputTemplate(om) {
  var available = om.templates; // array of strings, real AE scripting API
  for (var i = 0; i < FX_OUTPUT_TEMPLATE_CANDIDATES.length; i++) {
    for (var j = 0; j < available.length; j++) {
      if (available[j] === FX_OUTPUT_TEMPLATE_CANDIDATES[i]) {
        return { found: true, name: available[j], available: available };
      }
    }
  }
  return { found: false, name: null, available: available };
}

/**
 * Processes every *.json file in tools/pending-presets/ that isn't already
 * in data/effects-index.json: applies it to a duplicate of PreviewComp,
 * renders a preview mp4, grabs a thumbnail, updates the index, and moves the
 * pending file to tools/pending-presets/processed/.
 *
 * Returns a JSON-stringified report - never throws past this boundary.
 */
function fx_runPreviewGenerator(extensionRootPath) {
  var report = { processed: [], skipped: [], errors: [] };

  try {
    var root = extensionRootPath;
    fx_pg_log(root, "Preview Generator run started.");

    var pendingFolder = new Folder(root + "/tools/" + FX_PENDING_DIR_NAME);
    if (!pendingFolder.exists) {
      return JSON.stringify({ success: false, message: "Pending presets folder not found: " + pendingFolder.fsName });
    }

    var processedFolder = new Folder(pendingFolder.fsName + "/" + FX_PROCESSED_DIR_NAME);
    if (!processedFolder.exists) processedFolder.create();

    var indexFile = new File(root + "/data/effects-index.json");
    var indexData = fx_pg_readJsonFile(indexFile);
    var existingIds = {};
    for (var e = 0; e < indexData.effects.length; e++) existingIds[indexData.effects[e].id] = true;

    var pendingFiles = pendingFolder.getFiles("*.json");
    if (!pendingFiles || !pendingFiles.length) {
      fx_pg_log(root, "No pending preset files found.");
      return JSON.stringify({ success: true, data: report, message: "Nothing to process." });
    }

    var templateComp = fx_pg_findTemplateComp();
    if (!templateComp) {
      var msg = "Template comp '" + FX_TEMPLATE_COMP_NAME + "' not found in the open project. " +
        "Open the preview-template project described in tools/pending-presets/README.md first.";
      fx_pg_log(root, "ERROR: " + msg);
      return JSON.stringify({ success: false, message: msg });
    }

    for (var f = 0; f < pendingFiles.length; f++) {
      var file = pendingFiles[f];
      var def;
      try {
        def = fx_pg_readJsonFile(file);
      } catch (parseErr) {
        report.errors.push({ file: file.name, error: "Could not parse JSON: " + parseErr.toString() });
        continue;
      }

      if (!def.id) {
        report.errors.push({ file: file.name, error: "Missing required 'id' field." });
        continue;
      }
      if (existingIds[def.id]) {
        report.skipped.push({ id: def.id, reason: "already in effects-index.json" });
        continue;
      }

      app.beginUndoGroup("FXVault Preview Generator: " + def.id);
      try {
        var dupComp = templateComp.duplicate();
        dupComp.name = "FXVault_preview_" + def.id;
        dupComp.duration = FX_PREVIEW_DURATION_SECONDS;

        var sampleLayer = null;
        for (var L = 1; L <= dupComp.numLayers; L++) {
          if (dupComp.layer(L).name === FX_SAMPLE_LAYER_NAME) { sampleLayer = dupComp.layer(L); break; }
        }
        if (!sampleLayer) {
          throw new Error("Layer '" + FX_SAMPLE_LAYER_NAME + "' not found in " + FX_TEMPLATE_COMP_NAME);
        }

        var durationSeconds = (def.adjustmentLayer && def.adjustmentLayer.durationSeconds) || FX_PREVIEW_DURATION_SECONDS;
        var fxLayerName = (def.adjustmentLayer && def.adjustmentLayer.name) || def.name || def.id;
        var fxLayer = dupComp.layers.addSolid([1,1,1], fxLayerName, dupComp.width, dupComp.height, dupComp.pixelAspect, durationSeconds);
        fxLayer.adjustmentLayer = true;
        fxLayer.moveToBeginning();

        var appliedEffects = fx_pg_applyChainToLayer(fxLayer, def, 0);

        // Thumbnail: native AE frame export, no external tools required.
        var assetDir = new Folder(root + "/assets/effects/" + def.id);
        if (!assetDir.exists) assetDir.create();
        var thumbFile = new File(assetDir.fsName + "/thumbnail.png");
        dupComp.saveFrameToPng(Math.min(1.0, dupComp.duration / 2), thumbFile);

        // Preview render via Render Queue.
        var rqItem = app.project.renderQueue.items.add(dupComp);
        var om = rqItem.outputModule(1);
        var pick = fx_pg_pickOutputTemplate(om);
        var previewFile = new File(assetDir.fsName + "/preview.mp4");

        if (pick.found) {
          om.applyTemplate(pick.name);
          om.file = previewFile;
          app.project.renderQueue.render(); // blocking - waits for render to finish
        } else {
          rqItem.remove();
          throw new Error(
            "No matching H.264 output template found. Available templates on this machine: [" +
            pick.available.join(", ") + "]. Edit FX_OUTPUT_TEMPLATE_CANDIDATES in " +
            "tools/PreviewGenerator.jsx to match one of these, or create a new Output Module " +
            "template in AE (Edit > Templates > Output Module) named exactly " +
            "'H.264 - Match Render Settings - 15 Mbps'."
          );
        }

        indexData.effects.push({
          id: def.id,
          name: def.name || def.id,
          category: def.category || "Uncategorized",
          tags: def.tags || [],
          description: def.description || "",
          presetType: def.presetType || "scripted",
          ffxPath: def.ffxPath || null,
          adjustmentLayer: def.adjustmentLayer || { durationSeconds: FX_PREVIEW_DURATION_SECONDS, name: fxLayerName },
          effectChain: def.effectChain || [],
          transformExpressions: def.transformExpressions || undefined,
          transformKeyframes: def.transformKeyframes || undefined,
          thumbnail: "assets/effects/" + def.id + "/thumbnail.png",
          preview: "assets/effects/" + def.id + "/preview.mp4",
          favorited: false,
          version: def.version || "1.0.0"
        });
        existingIds[def.id] = true;

        dupComp.remove();

        file.copy(processedFolder.fsName + "/" + file.name);
        file.remove();

        report.processed.push({ id: def.id, appliedEffects: appliedEffects });
        fx_pg_log(root, "Processed '" + def.id + "' successfully.");

      } catch (innerErr) {
        report.errors.push({ id: def.id, error: innerErr.toString() });
        fx_pg_log(root, "ERROR processing '" + def.id + "': " + innerErr.toString());
      }
      app.endUndoGroup();
    }

    fx_pg_writeJsonFile(indexFile, indexData);
    fx_pg_log(root, "Preview Generator run finished. Processed=" + report.processed.length +
      " Skipped=" + report.skipped.length + " Errors=" + report.errors.length);

    return JSON.stringify({ success: true, data: report });

  } catch (outerErr) {
    return JSON.stringify({ success: false, message: "fx_runPreviewGenerator error: " + outerErr.toString() });
  }
}
