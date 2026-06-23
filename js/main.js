/**
 * FXVault main.js
 * ----------------
 * Boots the panel: resolves the extension's install path, loads the
 * database, builds the search index, runs asset validation, and wires up
 * all UI interactions (search, category chips, favorites, settings tab,
 * double-click-to-apply).
 */
(function () {
  var csInterface = new CSInterface();

  var db = null;
  var searchIndex = null;
  var settings = null;

  var state = {
    activeTab: "library",
    activeCategory: "All",
    query: "",
    zeroEffectsDiagActive: false
  };

  var els = {}; // populated in cacheEls()

  function cacheEls() {
    els.searchInput = document.getElementById("searchInput");
    els.searchCount = document.getElementById("searchCount");
    els.categoryChips = document.getElementById("categoryChips");
    els.effectGrid = document.getElementById("effectGrid");
    els.emptyState = document.getElementById("emptyState");
    els.assetWarning = document.getElementById("assetWarning");
    els.libraryView = document.getElementById("libraryView");
    els.settingsView = document.getElementById("settingsView");
    els.tabBtns = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
    els.settingsBtn = document.getElementById("settingsBtn");

    els.setAutoplay = document.getElementById("setAutoplay");
    els.setLoop = document.getElementById("setLoop");
    els.setLogLevel = document.getElementById("setLogLevel");
    els.setDuration = document.getElementById("setDuration");
    els.setApplyMode = document.getElementById("setApplyMode");
    els.saveSettingsBtn = document.getElementById("saveSettingsBtn");
    els.validateAssetsBtn = document.getElementById("validateAssetsBtn");
    els.clearLogBtn = document.getElementById("clearLogBtn");
    els.rescanLibraryBtn = document.getElementById("rescanLibraryBtn");
    els.runPreviewGenBtn = document.getElementById("runPreviewGenBtn");
    els.importPresetBtn = document.getElementById("importPresetBtn");
    els.importPresetInput = document.getElementById("importPresetInput");
    els.checkUpdateBtn = document.getElementById("checkUpdateBtn");
    els.applyUpdateBtn = document.getElementById("applyUpdateBtn");
    els.openRepoBtn = document.getElementById("openRepoBtn");
    els.updateStatusText = document.getElementById("updateStatusText");
    els.logViewer = document.getElementById("logViewer");
    els.logCount = document.getElementById("logCount");
    els.aboutText = document.getElementById("aboutText");
  }

  function normalizeExtensionRoot(raw) {
    if (!raw) return raw;
    if (raw.indexOf("file://") === 0) {
      var stripped = raw.replace(/^file:\/\//, "");
      // "file:///C:/Users/..." -> stripping "file://" leaves "/C:/Users/..."
      // on Windows - drop that leading slash before the drive letter.
      if (/^\/[A-Za-z]:/.test(stripped)) {
        stripped = stripped.substring(1);
      }
      try { stripped = decodeURIComponent(stripped); } catch (e) { /* leave as-is */ }
      return stripped;
    }
    return raw;
  }

  function resolveExtensionRoot() {
    try {
      var p = csInterface.getSystemPath(CSInterface.SystemPath.EXTENSION);
      if (p) return normalizeExtensionRoot(p);
    } catch (e) { /* fall through */ }
    // Fallback for non-CEP / dev-in-browser testing: current directory.
    return ".";
  }

  function showToast(message, kind) {
    var toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.className = "show" + (kind ? " toast-" + kind : "");
    toast.textContent = message;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
      toast.className = "";
    }, 2600);
  }

  // ---------------- Category chips ----------------

  function renderCategoryChips() {
    var cats = ["All"].concat(db.getCategories());
    els.categoryChips.innerHTML = "";
    cats.forEach(function (cat) {
      var chip = document.createElement("button");
      chip.className = "chip" + (cat === state.activeCategory ? " active" : "");
      chip.textContent = cat;
      chip.addEventListener("click", function () {
        state.activeCategory = cat;
        renderCategoryChips();
        renderLibrary();
      });
      els.categoryChips.appendChild(chip);
    });
  }

  // ---------------- Effect grid ----------------

  function getCurrentList() {
    var base;
    if (state.activeTab === "favorites") {
      base = db.getFavorites();
    } else {
      base = searchIndex.search(state.query);
    }

    if (state.activeTab === "library" && state.activeCategory !== "All") {
      base = base.filter(function (fx) { return fx.category === state.activeCategory; });
    }
    return base;
  }

  function buildCard(fx, assetReport) {
    var card = document.createElement("div");
    card.className = "effect-card";
    card.dataset.id = fx.id;

    var hasIssue = assetReport.missing.some(function (m) { return m.id === fx.id; });

    var previewWrap = document.createElement("div");
    previewWrap.className = "preview-wrap";

    if (fx.preview) {
      var video = document.createElement("video");
      video.src = fx.preview;
      video.muted = true;
      video.playsInline = true;
      video.loop = settings.get("loopPreviews");
      video.autoplay = settings.get("autoplayPreviews");
      video.addEventListener("error", function () {
        if (window.FXLogger) FXLogger.warn("Preview video failed to load", { id: fx.id, src: fx.preview });
      });
      previewWrap.appendChild(video);
    } else if (fx.thumbnail) {
      var img = document.createElement("img");
      img.src = fx.thumbnail;
      img.alt = fx.name;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.addEventListener("error", function () {
        if (window.FXLogger) FXLogger.warn("Thumbnail failed to load", { id: fx.id, src: fx.thumbnail });
      });
      previewWrap.appendChild(img);
    }

    var scanline = document.createElement("div");
    scanline.className = "scanline";
    previewWrap.appendChild(scanline);

    if (hasIssue) {
      var badge = document.createElement("div");
      badge.className = "card-asset-badge";
      badge.textContent = "ASSET";
      badge.title = "One or more assets are missing for this effect. See Settings > re-run asset validation.";
      previewWrap.appendChild(badge);
    }

    card.appendChild(previewWrap);

    var body = document.createElement("div");
    body.className = "card-body";

    var titleRow = document.createElement("div");
    titleRow.className = "card-title-row";

    var title = document.createElement("div");
    title.className = "card-title";
    title.textContent = fx.name;
    titleRow.appendChild(title);

    var favBtn = document.createElement("button");
    favBtn.className = "fav-btn" + (fx.favorited ? " active" : "");
    favBtn.innerHTML = fx.favorited ? "&#9733;" : "&#9734;";
    favBtn.title = fx.favorited ? "Remove from favorites" : "Add to favorites";
    favBtn.addEventListener("click", function (evt) {
      evt.stopPropagation();
      var nowFav = db.toggleFavorite(fx.id);
      favBtn.className = "fav-btn" + (nowFav ? " active" : "");
      favBtn.innerHTML = nowFav ? "&#9733;" : "&#9734;";
      if (window.FXLogger) FXLogger.info("Favorite toggled", { id: fx.id, favorited: nowFav });
      if (state.activeTab === "favorites") renderLibrary();
    });
    favBtn.addEventListener("dblclick", function (evt) { evt.stopPropagation(); });
    titleRow.appendChild(favBtn);

    body.appendChild(titleRow);

    var category = document.createElement("div");
    category.className = "card-category";
    category.textContent = fx.category;
    body.appendChild(category);

    card.appendChild(body);

    card.addEventListener("dblclick", function () {
      applyEffect(fx);
    });

    return card;
  }

  function renderLibrary() {
    var list = getCurrentList();
    var assetReport = db.validateAssets();

    els.effectGrid.innerHTML = "";
    list.forEach(function (fx) {
      els.effectGrid.appendChild(buildCard(fx, assetReport));
    });

    els.emptyState.classList.toggle("hidden", list.length > 0);
    els.searchCount.textContent = state.activeTab === "library"
      ? (list.length + " effect" + (list.length === 1 ? "" : "s"))
      : (list.length + " favorite" + (list.length === 1 ? "" : "s"));

    renderAssetWarning(assetReport);
  }

  function renderAssetWarning(assetReport) {
    if (state.zeroEffectsDiagActive) return; // don't clobber the boot-time diagnostic banner
    if (!assetReport.missing.length) {
      els.assetWarning.classList.add("hidden");
      return;
    }
    els.assetWarning.classList.remove("hidden");
    els.assetWarning.textContent = assetReport.missing.length + " effect(s) have missing assets (see the ASSET badge on the card, or Settings for details).";
  }

  // ---------------- Apply preset ----------------

  function applyEffect(fx) {
    var durationOverride = settings.get("adjustmentLayerDurationOverride");
    var payload = JSON.parse(JSON.stringify(fx)); // shallow clone, avoid mutating db copy

    if (payload.adjustmentLayer && durationOverride != null && !isNaN(durationOverride)) {
      payload.adjustmentLayer.durationSeconds = durationOverride;
    }

    var script;
    if (fx.presetType === "ffx") {
      var root = resolveExtensionRoot();
      var path = require("path");
      var absoluteFfxPath = path.join(root, fx.ffxPath);
      var durationSeconds = (payload.adjustmentLayer && payload.adjustmentLayer.durationSeconds) || 1.0;
      script = "fx_applyFfxPreset(" + JSON.stringify(payload.adjustmentLayer && payload.adjustmentLayer.name || fx.name) +
        ", " + JSON.stringify(absoluteFfxPath) + ", " + durationSeconds + ")";
    } else if (fx.presetType === "layout") {
      script = "fx_applySplitScreen(" + JSON.stringify(JSON.stringify(fx.layoutParams || {})) + ")";
    } else if (fx.presetType === "timeremap") {
      script = "fx_applyTimeRemap(" + JSON.stringify(JSON.stringify(fx.timeRemapParams || {})) + ")";
    } else if (fx.presetType === "randomflicker") {
      script = "fx_applyRandomFlicker(" + JSON.stringify(JSON.stringify(fx.randomParams || {})) + ")";
    } else {
      payload.applyMode = settings.get("applyMode") || "keyframed";
      var payloadString = JSON.stringify(payload);
      script = "fx_applyPreset(" + JSON.stringify(payloadString) + ")";
    }

    if (window.FXLogger) FXLogger.info("Applying preset", { id: fx.id, presetType: fx.presetType || "scripted" });

    csInterface.evalScript(script, function (result, bridgeErr) {
      if (bridgeErr) {
        if (window.FXLogger) FXLogger.error("evalScript bridge error applying preset", { id: fx.id, error: String(bridgeErr) });
        showToast("Could not reach After Effects: " + bridgeErr.message, "error");
        return;
      }
      var parsed;
      try {
        parsed = JSON.parse(result);
      } catch (e) {
        if (window.FXLogger) FXLogger.error("Could not parse hostscript response", { id: fx.id, raw: result });
        showToast("Unexpected response from After Effects.", "error");
        return;
      }

      if (parsed.success) {
        if (window.FXLogger) FXLogger.info("Preset applied", { id: fx.id, data: parsed.data });
        var detail = parsed.data && parsed.data.layerName
          ? "applied as \"" + parsed.data.layerName + "\""
          : "applied";
        showToast(fx.name + " " + detail, "success");
      } else {
        if (window.FXLogger) FXLogger.error("Preset apply failed", { id: fx.id, message: parsed.message });
        showToast("Apply failed: " + parsed.message, "error");
      }
    });
  }

  // ---------------- Tabs ----------------

  function switchTab(tabName, viewId) {
    state.activeTab = tabName;
    els.tabBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    document.getElementById(viewId).classList.add("active");

    if (tabName === "library" || tabName === "favorites") {
      els.categoryChips.classList.toggle("hidden", tabName === "favorites");
      renderLibrary();
    }
    if (tabName === "settings") {
      renderSettingsView();
    }
  }

  // ---------------- Settings view ----------------

  function renderSettingsView() {
    settings.populateForm({
      autoplay: els.setAutoplay,
      loop: els.setLoop,
      logLevel: els.setLogLevel,
      duration: els.setDuration,
      applyMode: els.setApplyMode
    });
    renderLogViewer();

    var versionInfo = {};
    try {
      var fsV = require("fs"), pathV = require("path");
      var root = resolveExtensionRoot();
      versionInfo = JSON.parse(fsV.readFileSync(pathV.join(root, "data", "version.json"), "utf8"));
    } catch (e) {
      if (window.FXLogger) FXLogger.warn("Could not read version.json for About text", { error: String(e) });
    }
    els.aboutText.textContent = "FXVault " + (versionInfo.currentVersion || "unknown version") +
      ". " + db.getEffects().length + " effects across " + db.getCategories().length + " categories.";
  }

  function renderLogViewer() {
    var entries = window.FXLogger ? FXLogger.getEntries().slice().reverse() : [];
    els.logCount.textContent = "(" + entries.length + ")";
    els.logViewer.innerHTML = "";
    if (!entries.length) {
      els.logViewer.innerHTML = "<div class=\"log-entry\"><span class=\"log-message\">No log entries yet.</span></div>";
      return;
    }
    entries.slice(0, 200).forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "log-entry";
      row.style.flexWrap = "wrap";
      var time = document.createElement("span");
      time.className = "log-time";
      time.textContent = entry.timestamp.substr(11, 8);
      var level = document.createElement("span");
      level.className = "log-level " + entry.level;
      level.textContent = entry.level.toUpperCase();
      var msg = document.createElement("span");
      msg.className = "log-message";
      msg.textContent = entry.message;
      row.appendChild(time);
      row.appendChild(level);
      row.appendChild(msg);

      if (entry.context !== null && entry.context !== undefined) {
        var detail = document.createElement("div");
        detail.style.width = "100%";
        detail.style.color = "#9A9AA3";
        detail.style.fontSize = "10.5px";
        detail.style.paddingLeft = "60px";
        detail.style.wordBreak = "break-word";
        try {
          detail.textContent = typeof entry.context === "string" ? entry.context : JSON.stringify(entry.context);
        } catch (e) {
          detail.textContent = String(entry.context);
        }
        row.appendChild(detail);
      }

      els.logViewer.appendChild(row);
    });
  }

  // ---------------- Wire up events ----------------

  function wireEvents() {
    els.searchInput.addEventListener("input", function () {
      state.query = els.searchInput.value;
      renderLibrary();
    });

    els.tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.dataset.tab, btn.dataset.view);
      });
    });

    els.settingsBtn.addEventListener("click", function () {
      switchTab("settings", "settingsView");
      els.tabBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === "settings"); });
    });

    els.saveSettingsBtn.addEventListener("click", function () {
      settings.readFormAndSave({
        autoplay: els.setAutoplay,
        loop: els.setLoop,
        logLevel: els.setLogLevel,
        duration: els.setDuration,
        applyMode: els.setApplyMode
      });
      renderLibrary();
      showToast("Settings saved", "success");
    });

    els.validateAssetsBtn.addEventListener("click", function () {
      var report = db.validateAssets();
      renderAssetWarning(report);
      renderLogViewer();
      showToast(report.missing.length
        ? report.missing.length + " effect(s) have asset issues - see log"
        : "All assets validated OK", report.missing.length ? "error" : "success");
    });

    els.importPresetBtn.addEventListener("click", function () {
      els.importPresetInput.click();
    });

    els.importPresetInput.addEventListener("change", function (evt) {
      var file = evt.target.files && evt.target.files[0];
      els.importPresetInput.value = ""; // reset so picking the same file again still fires change
      if (!file) return;

      // Node integration (--mixed-context) exposes the absolute path on the
      // File object directly - this is the standard CEP pattern for native
      // file pickers without a separate OS-dialog API.
      var sourcePath = file.path;
      if (!sourcePath) {
        showToast("Could not resolve the file's path - Node integration may be unavailable.", "error");
        return;
      }

      var defaultId = file.name.replace(/\.ffx$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      var id = window.prompt("Effect ID (lowercase, no spaces - used internally):", defaultId);
      if (!id) { showToast("Import cancelled."); return; }
      if (db.getEffectById(id)) { showToast("An effect with id \"" + id + "\" already exists.", "error"); return; }

      var name = window.prompt("Display name:", file.name.replace(/\.ffx$/i, ""));
      if (!name) { showToast("Import cancelled."); return; }

      var categories = db.getCategories();
      var category = window.prompt("Category (existing: " + categories.join(", ") + "):", categories[0] || "Uncategorized");
      var tagsRaw = window.prompt("Tags (comma separated):", "");
      var tags = (tagsRaw || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);

      var imported = db.importFfxPreset(sourcePath, { id: id, name: name, category: category, tags: tags });
      if (!imported) {
        showToast("Import failed - check the error log in Settings.", "error");
        return;
      }

      searchIndex.upsert(imported);
      renderCategoryChips();
      renderLibrary();
      showToast("Imported \"" + imported.name + "\" - placeholder thumbnail until a real preview is generated.", "success");
    });

    els.openRepoBtn.addEventListener("click", function () {
      try {
        require("child_process").exec(
          (process.platform === "win32" ? "start " : "open ") + FXUpdater.repoUrl()
        );
      } catch (e) {
        showToast("Repo: " + FXUpdater.repoUrl());
      }
    });

    els.checkUpdateBtn.addEventListener("click", function () {
      els.updateStatusText.textContent = "Checking...";
      var versionData = null;
      try {
        var fsU = require("fs"); var pathU = require("path");
        var root = resolveExtensionRoot();
        versionData = JSON.parse(fsU.readFileSync(pathU.join(root, "data", "version.json"), "utf8"));
      } catch (e) {
        if (window.FXLogger) FXLogger.error("Could not read local version.json", { error: String(e) });
      }

      FXUpdater.checkForUpdate(versionData).then(function (result) {
        if (!result.checked) {
          els.updateStatusText.textContent = "Could not check for updates: " + result.reason;
          if (window.FXLogger) FXLogger.error("Update check failed", { reason: result.reason });
          return;
        }
        if (result.updateAvailable) {
          els.updateStatusText.textContent =
            "Update available: " + result.localVersion + " -> " + result.remoteVersion +
            ". " + result.notes + " Click \"Open FXVAULT repo\" to grab it.";
          showToast("Update available: " + result.remoteVersion, "success");
        } else {
          els.updateStatusText.textContent = "You're up to date (" + result.localVersion + ").";
          showToast("Up to date", "success");
        }
        if (window.FXLogger) FXLogger.info("Update check completed", result);
      });
    });

    els.applyUpdateBtn.addEventListener("click", function () {
      var root = resolveExtensionRoot();
      els.updateStatusText.textContent = "Updating - downloading files...";
      els.applyUpdateBtn.disabled = true;

      FXAutoUpdater.applyUpdate(root).then(function (result) {
        els.applyUpdateBtn.disabled = false;

        if (!result.success) {
          els.updateStatusText.textContent = "Update failed: " + result.reason;
          if (window.FXLogger) FXLogger.error("Auto-update failed", { reason: result.reason });
          showToast("Update failed - see Settings for details", "error");
          return;
        }

        var msg = "Updated " + result.updated.length + " file(s).";
        if (result.failed.length) msg += " " + result.failed.length + " failed (see error log).";
        msg += " Close and reopen the FXVault panel for changes to take effect.";
        els.updateStatusText.textContent = msg;

        if (window.FXLogger) FXLogger.info("Auto-update applied", result);
        result.failed.forEach(function (f) {
          if (window.FXLogger) FXLogger.warn("Auto-update: file failed", f);
        });

        showToast(
          "Updated " + result.updated.length + " files" + (result.failed.length ? " (" + result.failed.length + " failed)" : ""),
          result.failed.length ? "error" : "success"
        );
      });
    });

    els.clearLogBtn.addEventListener("click", function () {
      if (window.FXLogger) FXLogger.clear();
      renderLogViewer();
      showToast("Error log cleared");
    });

    els.rescanLibraryBtn.addEventListener("click", function () {
      db.load();
      searchIndex.build(db.getEffects());
      renderCategoryChips();
      renderLibrary();
      if (window.FXLogger) FXLogger.info("Library rescanned", { effectCount: db.getEffects().length });
      showToast("Library rescanned - " + db.getEffects().length + " effects loaded", "success");
    });

    els.runPreviewGenBtn.addEventListener("click", function () {
      showToast("Running Preview Generator - this can take a while, watch the AE render queue...");
      csInterface.evalScript("fx_runPreviewGeneratorFromPanel()", function (result, bridgeErr) {
        if (bridgeErr) {
          if (window.FXLogger) FXLogger.error("Preview Generator bridge error", { error: String(bridgeErr) });
          showToast("Could not reach After Effects: " + bridgeErr.message, "error");
          return;
        }
        var parsed;
        try { parsed = JSON.parse(result); } catch (e) {
          if (window.FXLogger) FXLogger.error("Preview Generator returned unparseable result", { raw: result });
          showToast("Unexpected response from Preview Generator.", "error");
          return;
        }
        if (!parsed.success) {
          if (window.FXLogger) FXLogger.error("Preview Generator failed", { message: parsed.message });
          showToast("Preview Generator failed: " + parsed.message, "error");
          return;
        }
        var d = parsed.data || { processed: [], skipped: [], errors: [] };
        if (window.FXLogger) {
          FXLogger.info("Preview Generator finished", d);
        }
        showToast(
          "Generated " + d.processed.length + ", skipped " + d.skipped.length +
          ", errors " + d.errors.length + " - rescanning library",
          d.errors.length ? "error" : "success"
        );
        db.load();
        searchIndex.build(db.getEffects());
        renderCategoryChips();
        renderLibrary();
      });
    });
  }

  // ---------------- Boot ----------------

  function checkNodeIntegration() {
    try {
      var req = require;
      if (typeof req !== "function") return { ok: false, reason: "require is not a function in this context." };
      var fs = req("fs");
      if (!fs || typeof fs.existsSync !== "function") return { ok: false, reason: "require('fs') did not return a usable fs module." };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  function boot() {
    cacheEls();

    var nodeCheck = checkNodeIntegration();
    if (!nodeCheck.ok) {
      els.assetWarning.classList.remove("hidden");
      els.assetWarning.textContent =
        "Node file-system access is unavailable in this panel (" + nodeCheck.reason + "). " +
        "The effect library can't load without it. In After Effects, check " +
        "Edit > Preferences > Scripting & Expressions > \"Allow Scripts to Write Files and " +
        "Access Network\", then fully restart After Effects.";
      els.emptyState.classList.remove("hidden");
      els.emptyState.querySelector("p").textContent = "Library unavailable - see the warning above.";
      // Still try to wire up what we can (settings tab etc.) so the panel isn't totally dead.
    }

    var root = resolveExtensionRoot();

    if (window.FXLogger) {
      var path;
      try { path = require("path"); } catch (e) { path = null; }
      var logPath = path ? path.join(root, "data", "error-log.json") : root + "/data/error-log.json";
      FXLogger.init(logPath, "warn");
    }

    db = new FXDatabase(root);
    db.load();

    if (db.getEffects().length === 0) {
      var diag = "0 effects loaded. Resolved extension root: \"" + root + "\". ";
      try {
        var fsDiag = require("fs");
        var pathDiag = require("path");
        var expectedIndexPath = pathDiag.join(root, "data", "effects-index.json");
        diag += "Looking for: \"" + expectedIndexPath + "\". Exists: " + fsDiag.existsSync(expectedIndexPath) + ".";
        if (fsDiag.existsSync(expectedIndexPath)) {
          try {
            var raw = fsDiag.readFileSync(expectedIndexPath, "utf8");
            diag += " File size: " + raw.length + " bytes.";
          } catch (readErr) {
            diag += " But reading it threw: " + String(readErr);
          }
        }
      } catch (diagErr) {
        diag += " Could not even run the diagnostic check itself: " + String(diagErr);
      }
      els.assetWarning.classList.remove("hidden");
      els.assetWarning.textContent = diag;
      state.zeroEffectsDiagActive = true;
      if (window.FXLogger) FXLogger.error("Zero effects loaded - diagnostic", { diag: diag });
    }

    settings = new FXSettings(db);
    if (window.FXLogger) FXLogger.setLevel(settings.get("logLevel"));

    searchIndex = new FXSearchIndex();
    searchIndex.build(db.getEffects());

    var assetReport = db.validateAssets();
    if (window.FXLogger) {
      FXLogger.info("FXVault booted", { effectCount: db.getEffects().length, missingAssets: assetReport.missing.length });
    }

    renderCategoryChips();
    renderLibrary();
    wireEvents();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    document.addEventListener("DOMContentLoaded", boot);
  }
})();
