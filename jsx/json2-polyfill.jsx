// Minimal JSON polyfill for ExtendScript (ES3).
// Only loaded if the host's JSON object is missing. Supports the subset of
// JSON FXVault actually sends/receives: objects, arrays, strings, numbers,
// booleans, null. Not a full RFC 8259 implementation.
if (typeof JSON === "undefined") {
  JSON = {};

  JSON.stringify = function (value) {
    var t = typeof value;
    if (value === null) return "null";
    if (t === "number" || t === "boolean") return String(value);
    if (t === "string") return JSON._quote(value);
    if (value instanceof Array) {
      var arrParts = [];
      for (var i = 0; i < value.length; i++) {
        arrParts.push(JSON.stringify(value[i]));
      }
      return "[" + arrParts.join(",") + "]";
    }
    if (t === "object") {
      var objParts = [];
      for (var key in value) {
        if (value.hasOwnProperty(key)) {
          objParts.push(JSON._quote(key) + ":" + JSON.stringify(value[key]));
        }
      }
      return "{" + objParts.join(",") + "}";
    }
    return "null";
  };

  JSON._quote = function (s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
  };

  JSON.parse = function (text) {
    // ExtendScript has `eval` available; since this input only ever comes
    // from our own JSON.stringify on the JS panel side, eval is acceptable
    // here as a last-resort polyfill for legacy hosts.
    return eval("(" + text + ")");
  };
}
