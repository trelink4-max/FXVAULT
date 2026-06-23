/**
 * FXUpdater
 * ---------
 * Checks a hosted version.json (in the trelink4-max/FXVAULT GitHub repo)
 * against the locally installed data/version.json. This is "check + notify
 * + link to download" by design, NOT silent auto-install: a running CEP
 * panel can't safely overwrite its own files while AE has them open
 * (Windows frequently locks files in use), so the actual update step is
 * still a manual reinstall - this just saves you from having to come back
 * to chat to ask "is there a new version".
 */
(function (global) {
  var REPO_OWNER = "trelink4-max";
  var REPO_NAME = "FXVAULT";
  var BRANCH = "main"; // GitHub's current default branch name for new repos
  var VERSION_PATH = "version.json"; // single file at repo root - that's all this needs

  function remoteVersionUrl() {
    return "https://raw.githubusercontent.com/" + REPO_OWNER + "/" + REPO_NAME + "/" + BRANCH + "/" + VERSION_PATH;
  }

  function repoUrl() {
    return "https://github.com/" + REPO_OWNER + "/" + REPO_NAME;
  }

  var FXUpdater = {
    /**
     * Returns a Promise resolving to:
     *   { checked: true, updateAvailable: bool, localVersion, remoteVersion, repoUrl, notes }
     *   or { checked: false, reason: string } if the check itself failed
     *   (no network, repo not pushed to yet, branch name mismatch, etc.)
     */
    checkForUpdate: function (localVersionData) {
      var url = remoteVersionUrl() + "?_=" + Date.now(); // cache-bust so you always see the latest
      return fetch(url)
        .then(function (res) {
          if (!res.ok) {
            throw new Error("HTTP " + res.status + " fetching " + url +
              ". If this repo was just created, make sure data/version.json has been " +
              "uploaded to the '" + BRANCH + "' branch.");
          }
          return res.json();
        })
        .then(function (remoteData) {
          var localVersion = (localVersionData && localVersionData.currentVersion) || "unknown";
          var remoteVersion = remoteData.currentVersion || "unknown";
          var notes = (remoteData.history && remoteData.history[0] && remoteData.history[0].notes) || "";
          return {
            checked: true,
            updateAvailable: remoteVersion !== localVersion,
            localVersion: localVersion,
            remoteVersion: remoteVersion,
            repoUrl: repoUrl(),
            notes: notes
          };
        })
        .catch(function (err) {
          return { checked: false, reason: String(err && err.message ? err.message : err) };
        });
    },

    repoUrl: repoUrl
  };

  global.FXUpdater = FXUpdater;
})(window);
