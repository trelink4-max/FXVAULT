/**
 * Minimal CSInterface shim.
 *
 * This implements only the subset of Adobe's CSInterface API that FXVault
 * uses (evalScript + basic host/system info). It is intentionally small so
 * the panel has no external dependency to install.
 *
 * For production use, you can drop Adobe's official CSInterface.js (from the
 * open-source Adobe-CEP/CEP-Resources GitHub repo) directly over this file —
 * it exposes the same `evalScript` method plus the full CEP API surface
 * (event listeners, menu APIs, OS path helpers, etc.) that Phase 2+ may need.
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  try {
    var csInterfaceInternal = window.__adobe_cep__;
    if (!csInterfaceInternal || typeof csInterfaceInternal.evalScript !== "function") {
      var err = new Error("CEP host bridge (window.__adobe_cep__) is not available. " +
        "This file only works when loaded inside an Adobe CEP panel.");
      if (callback) callback(undefined, err);
      else throw err;
      return;
    }
    csInterfaceInternal.evalScript(script, function (result) {
      if (callback) callback(result);
    });
  } catch (e) {
    if (callback) callback(undefined, e);
    else throw e;
  }
};

CSInterface.prototype.getHostEnvironment = function () {
  try {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment());
  } catch (e) {
    return null;
  }
};

CSInterface.prototype.getSystemPath = function (pathType) {
  try {
    return window.__adobe_cep__.getSystemPath(pathType);
  } catch (e) {
    return null;
  }
};

CSInterface.SystemPath = {
  EXTENSION: "extension",
  USER_DATA: "userData"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CSInterface;
}
