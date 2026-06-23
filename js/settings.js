/**
 * FXSettings
 * ----------
 * Thin wrapper that connects the Settings view's form fields to the
 * persisted settings.json (via FXDatabase). Kept separate from main.js so
 * the settings schema can grow without touching grid/search/favorites code.
 */
(function (global) {
  function FXSettings(db) {
    this.db = db;
    this.current = db.getSettings();
    this._applyDefaults();
  }

  FXSettings.prototype._applyDefaults = function () {
    var defaults = {
      theme: "dark",
      adjustmentLayerDurationOverride: null,
      autoplayPreviews: true,
      loopPreviews: true,
      logLevel: "warn",
      sampleFootagePath: null,
      checkForUpdatesOnLaunch: false,
      applyMode: "keyframed" // "keyframed" | "constant"
    };
    for (var key in defaults) {
      if (defaults.hasOwnProperty(key) && !(key in this.current)) {
        this.current[key] = defaults[key];
      }
    }
  };

  FXSettings.prototype.get = function (key) {
    return this.current[key];
  };

  FXSettings.prototype.populateForm = function (formEls) {
    formEls.autoplay.checked = !!this.current.autoplayPreviews;
    formEls.loop.checked = !!this.current.loopPreviews;
    formEls.logLevel.value = this.current.logLevel || "warn";
    formEls.duration.value = this.current.adjustmentLayerDurationOverride != null
      ? this.current.adjustmentLayerDurationOverride
      : "";
    if (formEls.applyMode) formEls.applyMode.value = this.current.applyMode || "keyframed";
  };

  FXSettings.prototype.readFormAndSave = function (formEls) {
    this.current.autoplayPreviews = formEls.autoplay.checked;
    this.current.loopPreviews = formEls.loop.checked;
    this.current.logLevel = formEls.logLevel.value;
    var durVal = formEls.duration.value;
    this.current.adjustmentLayerDurationOverride = durVal === "" ? null : parseFloat(durVal);
    if (formEls.applyMode) this.current.applyMode = formEls.applyMode.value;

    var saved = this.db.saveSettings(this.current);
    if (global.FXLogger) {
      global.FXLogger.setLevel(this.current.logLevel);
      global.FXLogger.info("Settings saved", this.current);
    }
    return saved;
  };

  global.FXSettings = FXSettings;
})(window);
