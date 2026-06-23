/**
 * FXDatabase
 * ----------
 * Thin persistence layer over the JSON files in /data. Keeps the rest of the
 * app from caring about file paths or JSON shape. Every write is wrapped so
 * a failure is logged (via FXLogger) instead of crashing the panel.
 */
(function (global) {
  var fs;
  try {
    fs = require("fs");
  } catch (e) {
    fs = null;
  }
  var path;
  try {
    path = require("path");
  } catch (e) {
    path = null;
  }

  function FXDatabase(extensionRoot) {
    this.root = extensionRoot;
    this.paths = {
      effects: this._join("data", "effects-index.json"),
      favorites: this._join("data", "favorites.json"),
      settings: this._join("data", "settings.json"),
      version: this._join("data", "version.json")
    };
    this.effects = [];
    this.favoriteIds = [];
    this.settings = {};
  }

  FXDatabase.prototype._join = function () {
    var parts = Array.prototype.slice.call(arguments);
    if (path) return path.join.apply(path, [this.root].concat(parts));
    return this.root + "/" + parts.join("/");
  };

  FXDatabase.prototype._readJson = function (filePath, fallback) {
    if (!fs) return fallback;
    try {
      if (!fs.existsSync(filePath)) return fallback;
      var raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (global.FXLogger) global.FXLogger.error("Failed to read JSON file: " + filePath, { error: String(e) });
      return fallback;
    }
  };

  FXDatabase.prototype._writeJson = function (filePath, data) {
    if (!fs) return false;
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch (e) {
      if (global.FXLogger) global.FXLogger.error("Failed to write JSON file: " + filePath, { error: String(e) });
      return false;
    }
  };

  FXDatabase.prototype.load = function () {
    var effectsData = this._readJson(this.paths.effects, { effects: [] });
    var favoritesData = this._readJson(this.paths.favorites, { favoriteIds: [] });
    var settingsData = this._readJson(this.paths.settings, {});

    this.effects = effectsData.effects || [];
    this.favoriteIds = favoritesData.favoriteIds || [];
    this.settings = settingsData || {};

    // Reconcile favorited flag on each effect from the favorites store so
    // there is a single source of truth (favorites.json) but UI code can
    // still read effect.favorited directly for convenience.
    var favSet = {};
    this.favoriteIds.forEach(function (id) { favSet[id] = true; });
    this.effects.forEach(function (fx) { fx.favorited = !!favSet[fx.id]; });

    return this.effects;
  };

  FXDatabase.prototype.getEffects = function () {
    return this.effects;
  };

  FXDatabase.prototype.getEffectById = function (id) {
    return this.effects.filter(function (fx) { return fx.id === id; })[0] || null;
  };

  FXDatabase.prototype.getCategories = function () {
    var seen = {};
    var cats = [];
    this.effects.forEach(function (fx) {
      if (!seen[fx.category]) {
        seen[fx.category] = true;
        cats.push(fx.category);
      }
    });
    return cats.sort();
  };

  FXDatabase.prototype.toggleFavorite = function (id) {
    var idx = this.favoriteIds.indexOf(id);
    if (idx === -1) {
      this.favoriteIds.push(id);
    } else {
      this.favoriteIds.splice(idx, 1);
    }
    var fx = this.getEffectById(id);
    if (fx) fx.favorited = idx === -1;
    this._writeJson(this.paths.favorites, { schemaVersion: 1, favoriteIds: this.favoriteIds });
    return fx ? fx.favorited : false;
  };

  FXDatabase.prototype.getFavorites = function () {
    var favSet = {};
    this.favoriteIds.forEach(function (id) { favSet[id] = true; });
    return this.effects.filter(function (fx) { return favSet[fx.id]; });
  };

  FXDatabase.prototype.getSettings = function () {
    return this.settings;
  };

  FXDatabase.prototype.saveSettings = function (newSettings) {
    this.settings = newSettings;
    return this._writeJson(this.paths.settings, newSettings);
  };

  /**
   * Asset validation: confirms thumbnail / preview / preset assets referenced
   * by each effect actually exist on disk. Never throws - returns a report
   * the UI can render as warning badges, and logs each miss.
   */
  FXDatabase.prototype.validateAssets = function () {
    var self = this;
    var report = { ok: [], missing: [] };

    this.effects.forEach(function (fx) {
      var problems = [];

      if (fx.thumbnail) {
        var thumbPath = self._join(fx.thumbnail);
        if (fs && !fs.existsSync(thumbPath)) problems.push("thumbnail missing: " + fx.thumbnail);
      }
      if (fx.preview) {
        var prevPath = self._join(fx.preview);
        if (fs && !fs.existsSync(prevPath)) problems.push("preview missing: " + fx.preview);
      }
      if (fx.presetType === "ffx" && fx.ffxPath) {
        var ffxPath = self._join(fx.ffxPath);
        if (fs && !fs.existsSync(ffxPath)) problems.push(".ffx preset missing: " + fx.ffxPath);
      }
      if (fx.presetType === "scripted" && (!fx.effectChain && !fx.transformExpressions)) {
        problems.push("scripted preset has no effectChain and no transformExpressions - nothing would be applied");
      }

      if (problems.length) {
        report.missing.push({ id: fx.id, name: fx.name, problems: problems });
        if (global.FXLogger) {
          global.FXLogger.warn("Asset validation issues for effect '" + fx.id + "'", { problems: problems });
        }
      } else {
        report.ok.push(fx.id);
      }
    });

    return report;
  };

  /**
   * Imports a real, already-exported .ffx file: copies it into
   * assets/effects/<id>/preset.ffx, writes a placeholder thumbnail (a real
   * render/thumbnail needs an AE pass - see Preview Generator), and appends
   * a presetType:"ffx" entry to effects-index.json. Returns the new effect
   * object, or null on failure (with the reason logged via FXLogger).
   */
  FXDatabase.prototype.importFfxPreset = function (sourcePath, meta) {
    if (!fs || !path) {
      if (global.FXLogger) global.FXLogger.error("importFfxPreset: fs/path unavailable.");
      return null;
    }
    try {
      if (!fs.existsSync(sourcePath)) {
        if (global.FXLogger) global.FXLogger.error("importFfxPreset: source file not found.", { sourcePath: sourcePath });
        return null;
      }

      var id = meta.id;
      if (!id) {
        if (global.FXLogger) global.FXLogger.error("importFfxPreset: missing id.");
        return null;
      }
      if (this.getEffectById(id)) {
        if (global.FXLogger) global.FXLogger.error("importFfxPreset: id already exists.", { id: id });
        return null;
      }

      var assetDir = this._join("assets", "effects", id);
      if (!fs.existsSync(assetDir)) {
        // fs.mkdirSync without recursive option is fine here - "assets/effects" already exists.
        fs.mkdirSync(assetDir);
      }

      var destFfx = path.join(assetDir, "preset.ffx");
      fs.copyFileSync(sourcePath, destFfx);

      this._writePlaceholderThumbnail(path.join(assetDir, "thumbnail.png"));

      var newEffect = {
        id: id,
        name: meta.name || id,
        category: meta.category || "Uncategorized",
        tags: meta.tags || [],
        description: meta.description || "Imported .ffx preset.",
        presetType: "ffx",
        ffxPath: "assets/effects/" + id + "/preset.ffx",
        adjustmentLayer: { durationSeconds: meta.durationSeconds || 1.0, name: meta.name || id },
        effectChain: [],
        thumbnail: "assets/effects/" + id + "/thumbnail.png",
        preview: null,
        favorited: false,
        version: "1.0.0"
      };

      this.effects.push(newEffect);
      this._writeJson(this.paths.effects, { schemaVersion: 1, effects: this.effects });

      if (global.FXLogger) global.FXLogger.info("Imported .ffx preset", { id: id, sourcePath: sourcePath });
      return newEffect;
    } catch (e) {
      if (global.FXLogger) global.FXLogger.error("importFfxPreset failed", { error: String(e) });
      return null;
    }
  };

  /**
   * Writes a minimal valid 1x1 PNG as a placeholder thumbnail so the card
   * grid and asset validator have something real on disk to point at,
   * rather than a missing-file warning, until a proper thumbnail is
   * generated (Preview Generator, or a manual render).
   */
  FXDatabase.prototype._writePlaceholderThumbnail = function (destPath) {
    // Smallest valid 1x1 black PNG, base64-encoded - a real (if tiny) PNG file,
    // not a fake extension. The UI's CSS will simply stretch it as a dark tile.
    // Written via fs's base64 encoding option rather than a bare Buffer
    // reference, since Buffer isn't guaranteed to be a global in every
    // mixed-context CEP environment.
    var base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    fs.writeFileSync(destPath, base64, "base64");
  };

  global.FXDatabase = FXDatabase;
})(window);
