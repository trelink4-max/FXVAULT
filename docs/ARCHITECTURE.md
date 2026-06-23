# Architecture

## Process model

CEP panels run two separate JS contexts:

1. **Panel context** (`index.html` + everything in `js/`) — a Chromium tab.
   This is where the UI lives, and (because the manifest enables
   `--enable-nodejs`/`--mixed-context`) it also has direct Node `fs`/`path`
   access, which is what `db.js` and `logger.js` use to persist data without
   needing a separate server process.
2. **ExtendScript context** (`jsx/hostscript.jsx`) — the actual After Effects
   scripting engine. This is the only code that can touch `app`, `CompItem`,
   `Layer`, etc.

The two contexts talk to each other exclusively through
`CSInterface.evalScript(script, callback)`: the panel builds a JS *string*
containing an ExtendScript function call, AE evaluates it, and returns a
JSON string back through the callback. There is no shared memory — every
payload must be serialized.

```
index.html / main.js                    hostscript.jsx (inside AE)
  |                                            |
  | csInterface.evalScript(                    |
  |   'fx_applyPreset("{...json...}")',  ----> | fx_applyPreset(payloadJson)
  |   callback)                                |   - JSON.parse(payload)
  |                                             |   - comp.layers.addSolid(...)
  |                                             |   - newLayer.Effects.addProperty(matchName)
  |                                             |   - prop.setValue(...) / .expression = ...
  |  callback(resultJsonString)  <------------- |   - return JSON.stringify({success, data})
  v
parse + toast + log
```

## Why presets are "scripted" (JSON effect chains) rather than `.ffx` files

A `.ffx` is a binary serialized AE project fragment. It can't be authored as
text/code — it has to be exported from a real running copy of After Effects
(`Animation > Save Animation Preset`, or `Layer.applyPreset`'s sibling
export). Since this environment has no AE installation, Phase 1 represents
each preset as a JSON "effect chain": a list of real AE effect matchNames
(e.g. `ADBE Curves`, `ADBE Shift Channels`) plus property values, which
`hostscript.jsx` applies via `Effects.addProperty(matchName)` +
`property.setValue(...)`. This is itself a legitimate, commonly-used AE
automation technique (not a workaround/fake) — it's how many real scripted
AE tools build looks programmatically.

Effects that do get a real exported `.ffx` later can be flipped to
`"presetType": "ffx"` with a populated `"ffxPath"` — `hostscript.jsx`
already has `fx_applyFfxPreset()` implemented and ready to call AE's native
`layer.applyPreset(file)` for that case. No JS-side code needs to change.

## Database / search / favorites: single JSON source of truth

`data/effects-index.json` is the canonical effect list. `favorites.json`
stores only an array of favorited IDs (not duplicated effect data), so
`db.js` reconciles `effect.favorited` from that array on every load — this
keeps a single source of truth for "is this favorited" and makes it
impossible for the two to drift.

`search.js` builds a token -> effect-id inverted index from name, category,
description, and tags. It exposes both `build()` (full rebuild) and
`upsert()` (incremental add) — the latter exists specifically so the Phase 2
Preview Generator can register a newly-detected effect without any of this
file's code changing.

## Error logging

`logger.js` keeps an in-memory ring buffer (last 500 entries) for the
in-panel log viewer, and persists the same buffer to `data/error-log.json`
on every write so log history survives a panel reload. Every `db.js` read/
write, and every `evalScript` callback in `main.js`, is wrapped so failures
get logged with context instead of throwing into the void.

## Asset validation

`db.validateAssets()` walks every effect's `thumbnail`/`preview`/`ffxPath`
fields and checks `fs.existsSync`. It never throws — a missing asset
produces a warning badge on the card and a logged warning, not a crash. This
runs once on boot and again on demand from Settings.
