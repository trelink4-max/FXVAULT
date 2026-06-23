/**
 * FXSearchIndex
 * -------------
 * Lightweight in-memory inverted index. Rebuilt whenever the effect list
 * changes (new preset detected, effect renamed, etc.) - this is the same
 * "indexer" the Phase 2 Preview Generator will call into automatically
 * after it registers a new effect, which is why it's a standalone module
 * rather than inline code in main.js.
 */
(function (global) {
  function tokenize(str) {
    if (!str) return [];
    return String(str)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function FXSearchIndex() {
    this.index = {}; // token -> Set-like object of effect ids
    this.effectsById = {};
  }

  FXSearchIndex.prototype.build = function (effects) {
    var self = this;
    this.index = {};
    this.effectsById = {};

    effects.forEach(function (fx) {
      self.effectsById[fx.id] = fx;

      var tokens = []
        .concat(tokenize(fx.name))
        .concat(tokenize(fx.category))
        .concat(tokenize(fx.description))
        .concat((fx.tags || []).reduce(function (acc, t) { return acc.concat(tokenize(t)); }, []));

      tokens.forEach(function (token) {
        if (!self.index[token]) self.index[token] = {};
        self.index[token][fx.id] = true;
      });
    });

    if (global.FXLogger) {
      global.FXLogger.info("Search index built", { effectCount: effects.length, tokenCount: Object.keys(this.index).length });
    }
  };

  /**
   * Adds (or updates) a single effect in the index without a full rebuild.
   * This is the hook the Preview Generator (Phase 2) calls so adding a new
   * effect never requires touching this file.
   */
  FXSearchIndex.prototype.upsert = function (fx) {
    this.effectsById[fx.id] = fx;
    var self = this;
    var tokens = []
      .concat(tokenize(fx.name))
      .concat(tokenize(fx.category))
      .concat(tokenize(fx.description))
      .concat((fx.tags || []).reduce(function (acc, t) { return acc.concat(tokenize(t)); }, []));
    tokens.forEach(function (token) {
      if (!self.index[token]) self.index[token] = {};
      self.index[token][fx.id] = true;
    });
  };

  /**
   * Ranked substring + token search. Returns effect objects sorted by score
   * descending. Empty query returns everything (in original order).
   */
  FXSearchIndex.prototype.search = function (query) {
    var self = this;
    var q = (query || "").trim().toLowerCase();
    var all = Object.keys(this.effectsById).map(function (id) { return self.effectsById[id]; });

    if (!q) return all;

    var qTokens = tokenize(q);
    var scores = {};

    Object.keys(this.effectsById).forEach(function (id) {
      var fx = self.effectsById[id];
      var score = 0;
      var haystack = (fx.name + " " + fx.category + " " + (fx.tags || []).join(" ") + " " + (fx.description || "")).toLowerCase();

      // Exact substring match on the full query is the strongest signal.
      if (haystack.indexOf(q) !== -1) score += 10;

      // Token overlap via the inverted index.
      qTokens.forEach(function (token) {
        Object.keys(self.index).forEach(function (indexedToken) {
          if (indexedToken.indexOf(token) !== -1 && self.index[indexedToken][id]) {
            score += indexedToken === token ? 3 : 1;
          }
        });
      });

      // Name prefix match boosts ranking - typing "wh" should surface "White Flash" first.
      if (fx.name.toLowerCase().indexOf(q) === 0) score += 5;

      if (score > 0) scores[id] = score;
    });

    return Object.keys(scores)
      .sort(function (a, b) { return scores[b] - scores[a]; })
      .map(function (id) { return self.effectsById[id]; });
  };

  global.FXSearchIndex = FXSearchIndex;
})(window);
