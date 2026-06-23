# Preview Generator (Phase 2)

Automates what we did by hand for the 5 seed effects: apply a preset to
sample footage, render a 3-4 second preview, grab a thumbnail, and register
the effect in `data/effects-index.json` - so adding effect #6 onward never
requires touching `db.js`, `search.js`, or any panel code.

## One-time setup (you need to do this in After Effects)

The generator needs a template project with a comp it can duplicate for
each new effect:

1. In After Effects, create a new comp named exactly **`PreviewComp`**
   - 1280x720, at least 4 seconds long, any frame rate (24fps recommended
     to match the Phase 1 seed previews)
2. Add your sample footage (a photo, or short clip) as a layer named
   exactly **`SampleFootage`**
3. Save this project somewhere you'll keep reopening it for batch runs -
   e.g. `tools/preview-template.aep` (not included here - this is a binary
   AE project file, which has to be created inside AE; this tool can't
   author one from outside AE)
4. Make sure your AE has an Output Module template that can write `.mp4`
   (H.264). If you're not sure, open **Edit > Templates > Output Module**
   and check the list of template names - if none of them write MP4/H.264,
   create one. **Newer AE versions sometimes only ship lossless/PNG-sequence
   templates out of the box and push H.264 export to Adobe Media Encoder
   instead** - if that's the case on your machine, either create an H.264
   Output Module template manually, or let me know and I'll add an
   Adobe-Media-Encoder-queue code path instead of the plain Render Queue.

## Adding a new effect

1. Drop a `.json` file in this folder (`tools/pending-presets/`) describing
   the effect. Schema (see `bass-shake.json` next to this README for a real
   example):

   ```json
   {
     "id": "unique-effect-id",
     "name": "Display Name",
     "category": "Shakes",
     "tags": ["tag1", "tag2"],
     "description": "One sentence.",
     "presetType": "scripted",
     "adjustmentLayer": { "durationSeconds": 1.0, "name": "Layer Name" },
     "effectChain": [
       { "matchName": "ADBE Curves", "displayName": "Curves", "properties": [] }
     ],
     "transformExpressions": { "Position": "wiggle(4,28)" },
     "version": "1.0.0"
   }
   ```

   - `effectChain` entries use real AE effect matchNames (see
     `docs/ARCHITECTURE.md` for why we do it this way instead of `.ffx`).
   - `transformExpressions` / `transformKeyframes` are optional, same shape
     as in `data/effects-index.json`.

2. With the template project (`PreviewComp` etc.) open in AE, run the
   generator one of two ways:
   - **From the panel:** Settings tab > "Generate previews for pending
     effects" button (calls `fx_runPreviewGeneratorFromPanel` via evalScript).
   - **As a standalone script:** File > Scripts > Run Script File... >
     `tools/PreviewGenerator.jsx`, then manually call
     `fx_runPreviewGenerator("/absolute/path/to/FXVault")` from the
     ExtendScript console, or wrap that single call in a tiny launcher
     script if you want a double-clickable `.jsx`.

3. For each pending file, the generator:
   - duplicates `PreviewComp`, applies the effect chain to a new adjustment
     layer over `SampleFootage`
   - renders `assets/effects/<id>/preview.mp4`
   - saves `assets/effects/<id>/thumbnail.png` (native AE frame export, no
     ffmpeg needed)
   - appends the effect to `data/effects-index.json`
   - moves the processed `.json` file into `processed/` so it won't be
     redone next run
   - logs everything to `data/preview-generator.log`

4. Back in the panel, click **Settings > Rescan library** (no AE restart
   needed) and the new effect appears, fully searchable and categorized.

## What this environment could and couldn't verify

This generator script was written and syntax-checked outside After Effects
(no AE install is available in the sandbox that built FXVault). The JSON
parsing, effect-chain application logic, and file I/O reuse the exact same
code path as `fx_applyPreset` (already proven working in Phase 1), so the
*logic* is shared and trustworthy. What's untested end-to-end is the
Render Queue / Output Module step specifically, since that requires a real
AE render. If `fx_runPreviewGenerator` reports an output-template error,
the error message will list every template name actually available on
your machine - update `FX_OUTPUT_TEMPLATE_CANDIDATES` in
`tools/PreviewGenerator.jsx` to match one of them.
