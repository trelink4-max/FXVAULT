/**
 * FXAutoUpdater
 * -------------
 * Downloads and applies code-file updates directly, no manual zip/reinstall
 * needed for routine changes. Scoped deliberately to CODE + APP DATA only:
 *
 *   - Will overwrite: js/*, jsx/*, css/*, CSXS/manifest.xml, index.html,
 *     docs/*, scripts/*, tools/*, data/effects-index.json, data/version.json
 *   - Will NEVER touch: data/favorites.json, data/settings.json,
 *     data/error-log.json (your saved state), or anything under assets/
 *     (preview videos/thumbnails - those still come via a full zip when a
 *     new effect bundle ships, since GitHub's upload UI can't reasonably
 *     handle 150+ binary files at once).
 *
 * Mechanism: fetches manifest.json (a list of {path, url} pairs) from the
 * repo, then fetches each file's raw content individually and writes it to
 * the matching local path with fs.writeFileSync. No zip/unzip needed at all.
 */
(function (global) {
  var REPO_OWNER = "trelink4-max";
  var REPO_NAME = "FXVAULT";
  var BRANCH = "main";
  var MANIFEST_PATH = "manifest.json";

  function manifestUrl() {
    return "https://raw.githubusercontent.com/" + REPO_OWNER + "/" + REPO_NAME + "/" + BRANCH + "/" + MANIFEST_PATH + "?_=" + Date.now();
  }

  var FXAutoUpdater = {
    /**
     * Returns a Promise resolving to:
     *   { success: true, updated: [...paths], failed: [{path, error}], skipped: [...] }
     *   or { success: false, reason: string }
     */
    applyUpdate: function (localRoot) {
      var fs, path;
      try {
        fs = require("fs");
        path = require("path");
      } catch (e) {
        return Promise.resolve({ success: false, reason: "Node fs/path unavailable: " + String(e) });
      }

      return fetch(manifestUrl())
        .then(function (res) {
          if (!res.ok) throw new Error("Could not fetch manifest.json (HTTP " + res.status + "). Has it been uploaded to the repo yet?");
          return res.json();
        })
        .then(function (manifest) {
          var entries = manifest.files || [];
          if (!entries.length) throw new Error("manifest.json has no files listed.");

          var updated = [], failed = [], skipped = [];

          function processNext(i) {
            if (i >= entries.length) {
              return Promise.resolve({ success: true, updated: updated, failed: failed, skipped: skipped });
            }
            var entry = entries[i];
            var localPath = path.join(localRoot, entry.path);
            var fetchUrl = entry.url + "?_=" + Date.now();

            return fetch(fetchUrl)
              .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.text();
              })
              .then(function (content) {
                var dir = path.dirname(localPath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(localPath, content, "utf8");
                updated.push(entry.path);
              })
              .catch(function (err) {
                failed.push({ path: entry.path, error: String(err) });
              })
              .then(function () {
                return processNext(i + 1);
              });
          }

          return processNext(0);
        })
        .catch(function (err) {
          return { success: false, reason: String(err && err.message ? err.message : err) };
        });
    }
  };

  global.FXAutoUpdater = FXAutoUpdater;
})(window);
