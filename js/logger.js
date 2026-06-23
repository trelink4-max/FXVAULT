/**
 * Logger
 * ------
 * Persistent error/warning/info logger for FXVault.
 *
 * Relies on Node's `fs` module, which is available inside this CEP panel
 * because the manifest enables --enable-nodejs / --mixed-context. If for any
 * reason Node integration is unavailable (e.g. someone disabled it), the
 * logger degrades gracefully to console-only logging instead of throwing.
 */
(function (global) {
  var fs;
  try {
    fs = require("fs");
  } catch (e) {
    fs = null;
  }

  var LOG_PATH = null; // set via init()
  var MAX_ENTRIES = 500;
  var memoryBuffer = [];

  var LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

  function nowIso() {
    return new Date().toISOString();
  }

  function readLogFile() {
    if (!fs || !LOG_PATH) return { schemaVersion: 1, entries: [] };
    try {
      if (!fs.existsSync(LOG_PATH)) return { schemaVersion: 1, entries: [] };
      var raw = fs.readFileSync(LOG_PATH, "utf8");
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return { schemaVersion: 1, entries: [] };
      return parsed;
    } catch (e) {
      // Corrupt log file should never crash the extension - reset it.
      console.error("FXVault Logger: error-log.json was unreadable, resetting.", e);
      return { schemaVersion: 1, entries: [] };
    }
  }

  function writeLogFile(data) {
    if (!fs || !LOG_PATH) return false;
    try {
      fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch (e) {
      console.error("FXVault Logger: failed to persist log file.", e);
      return false;
    }
  }

  var Logger = {
    minLevel: "warn",

    init: function (logFilePath, minLevel) {
      LOG_PATH = logFilePath;
      if (minLevel) this.minLevel = minLevel;
      var existing = readLogFile();
      memoryBuffer = existing.entries || [];
    },

    setLevel: function (level) {
      if (LEVELS.hasOwnProperty(level)) this.minLevel = level;
    },

    log: function (level, message, context) {
      if (!LEVELS.hasOwnProperty(level)) level = "info";

      var entry = {
        timestamp: nowIso(),
        level: level,
        message: String(message),
        context: context || null
      };

      // Always keep an in-memory record for the in-panel log viewer,
      // regardless of minLevel, so the user can raise verbosity retroactively
      // within a session.
      memoryBuffer.push(entry);
      if (memoryBuffer.length > MAX_ENTRIES) {
        memoryBuffer = memoryBuffer.slice(memoryBuffer.length - MAX_ENTRIES);
      }

      if (LEVELS[level] >= LEVELS[this.minLevel]) {
        var consoleFn = level === "error" ? console.error : (level === "warn" ? console.warn : console.log);
        consoleFn("[FXVault][" + level.toUpperCase() + "]", message, context || "");
      }

      this._persist();
      return entry;
    },

    debug: function (message, context) { return this.log("debug", message, context); },
    info: function (message, context) { return this.log("info", message, context); },
    warn: function (message, context) { return this.log("warn", message, context); },
    error: function (message, context) { return this.log("error", message, context); },

    _persist: function () {
      writeLogFile({ schemaVersion: 1, entries: memoryBuffer });
    },

    getEntries: function (filterLevel) {
      if (!filterLevel) return memoryBuffer.slice();
      return memoryBuffer.filter(function (e) { return e.level === filterLevel; });
    },

    clear: function () {
      memoryBuffer = [];
      this._persist();
    }
  };

  global.FXLogger = Logger;
})(window);
