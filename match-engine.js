'use strict';
// ModruleSync's matching engine -- pure logic, no DOM access, so it can be reasoned about (and, if
// this project ever grows a test runner, unit-tested) in complete isolation from the UI. Implements
// vortex-collection-tools' own design/SPEC-pgpatcher-priority-merge-tool.md "Matching algorithm"
// section verbatim -- see that spec for the full rationale (real naming-drift example, why each tier
// exists, why fuzzy matches never auto-apply). This file is a plain global (`ModruleSyncEngine`), not
// an ES module, so index.html can load it with a plain <script src> and the whole page works from a
// local file:// open too, not just over http.

var ModruleSyncEngine = (function () {
  var DEFAULT_FUZZY_FLOOR = 0.45; // spec's own design-review note: bias loose, not tight -- every
                                   // fuzzy candidate already requires human confirmation, so a spare
                                   // low-quality suggestion costs a glance; a real match silently
                                   // missing costs the user noticing and hunting for it by hand.
  var MAX_CANDIDATES = 5;

  // Spec's own exact regex: strip a trailing run of space-separated numeric/version-ish tokens, then
  // compare case-insensitively. This is the heuristic that correctly pairs the real observed
  // "Window Shadows Ultimate - Patch Hub 151548 1.1 2026" vs. "Window Shadows Ultimate - Patch Hub"
  // drift (see spec's "Real-world grounding" section) -- PGPatcher's own name-normalization regex
  // only strips a HYPHEN-flanked suffix, so it misses this exact case.
  function normalizeName(name) {
    return String(name).replace(/\s+[\d.]+(?:\s+[\d.]+)*\s*$/, '').trim().toLowerCase();
  }

  // Standard Levenshtein edit distance, iterative DP (two-row rolling buffer, no full matrix needed).
  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    var prev = new Array(lb + 1);
    var curr = new Array(lb + 1);
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      curr[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (var jj = 1; jj <= lb; jj++) {
        var cost = ca === b.charCodeAt(jj - 1) ? 0 : 1;
        curr[jj] = Math.min(
          prev[jj] + 1,      // deletion
          curr[jj - 1] + 1,  // insertion
          prev[jj - 1] + cost // substitution
        );
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[lb];
  }

  // Normalized similarity in [0, 1] -- 1 means identical (case-insensitive), 0 means nothing shared.
  // Simplest ratio that's easy to reason about without a test framework: 1 - (edit distance / longer
  // string's length). Judgment call, flagged in the build's own handoff -- longest-common-prefix was
  // the spec's other suggested option, but a plain edit-distance ratio handles a reordered/altered
  // middle segment (not just a differing suffix) better, which real mod-name drift can plausibly do.
  function similarity(a, b) {
    var la = String(a).toLowerCase();
    var lb = String(b).toLowerCase();
    if (la === lb) return 1;
    var maxLen = Math.max(la.length, lb.length);
    if (maxLen === 0) return 1;
    return 1 - levenshteinDistance(la, lb) / maxLen;
  }

  function priorityOf(rulesObj, name) {
    var entry = rulesObj[name];
    return entry && typeof entry.priority === 'number' ? entry.priority : -1;
  }

  // The core matching pass. authorRules/userRules are plain objects keyed by mod name (the same shape
  // a real modrules.json has: {priority, enabled, meshesignored}). Every key in userRules ends up in
  // EXACTLY ONE of the four returned buckets -- exact, normalized, review, newMods -- a full
  // partition, per the spec's own UI-flow section. Author-only entries (never matched at all) are
  // simply never referenced by anything this returns -- callers only ever write into userRules' own
  // key space (see buildFinalRules), so there's no separate "dropped" list to track.
  function buildMatchReport(authorRules, userRules, opts) {
    opts = opts || {};
    var floor = opts.fuzzyFloor != null ? opts.fuzzyFloor : DEFAULT_FUZZY_FLOOR;
    var maxCandidates = opts.maxCandidates != null ? opts.maxCandidates : MAX_CANDIDATES;

    // Author names not yet claimed. Restricted to entries the author actually curated a priority
    // for (priority !== -1, i.e. enabled) -- the rest of a real modrules.json is just every mod
    // PGPatcher scanned with nothing to transplant, and matching against those produced pure-noise
    // candidates (a name coincidentally close to an unrelated, unconfigured mod).
    var remaining = new Set(Object.keys(authorRules).filter(function (name) {
      return priorityOf(authorRules, name) !== -1;
    }));
    var exact = [];
    var normalized = [];
    var review = [];
    var newMods = [];

    // Tier 1: exact string match.
    var afterTier1 = [];
    Object.keys(userRules).forEach(function (userName) {
      if (remaining.has(userName)) {
        exact.push({ userName: userName, authorName: userName, priority: priorityOf(authorRules, userName) });
        remaining.delete(userName);
      } else {
        afterTier1.push(userName);
      }
    });

    // Tier 2: normalized match (case-insensitive, trailing version/number run stripped).
    var afterTier2 = [];
    afterTier1.forEach(function (userName) {
      var normUser = normalizeName(userName);
      var found = null;
      remaining.forEach(function (authorName) {
        if (!found && normalizeName(authorName) === normUser) found = authorName;
      });
      if (found) {
        normalized.push({ userName: userName, authorName: found, priority: priorityOf(authorRules, found) });
        remaining.delete(found);
      } else {
        afterTier2.push(userName);
      }
    });

    // Tier 3/4: fuzzy candidates against whatever's STILL unclaimed, human-confirmed only. Nothing
    // is removed from `remaining` here -- a tier-3 match isn't real until the user confirms it in the
    // reconciliation step (see claimCandidate below), and the same remaining author entry can
    // legitimately show up as a candidate for more than one still-unresolved row until then.
    var remainingArr = Array.from(remaining);
    afterTier2.forEach(function (userName) {
      var candidates = remainingArr
        .map(function (authorName) {
          return { authorName: authorName, score: similarity(userName, authorName), priority: priorityOf(authorRules, authorName) };
        })
        .filter(function (c) { return c.score >= floor; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, maxCandidates);

      if (candidates.length > 0) {
        review.push({ userName: userName, candidates: candidates, status: 'pending', chosenAuthorName: null });
      } else {
        newMods.push(userName);
      }
    });

    return { exact: exact, normalized: normalized, review: review, newMods: newMods };
  }

  // Called once a reconciliation row is confirmed -- removes that author name from every OTHER still-
  // pending row's own candidate list, live. Without this, two different unmatched user mods could both
  // get offered (and both confirm) the SAME author entry, silently assigning one author priority to
  // two different real mods. Mutates `review` in place; returns nothing.
  function removeCandidateEverywhere(review, authorName, exceptUserName) {
    review.forEach(function (row) {
      if (row.userName === exceptUserName) return;
      row.candidates = row.candidates.filter(function (c) { return c.authorName !== authorName; });
    });
  }

  // Final merge -- spec's own "What actually gets merged" + "canonical-name rule" sections, applied
  // literally: output keys are ALWAYS the end-user's own names (rankedNames/unrankedNames both come
  // from the end-user's file, never the author's), priority is recomputed the same
  // `priority = order.length - index` way the real Load Order Editor's own /save route already does
  // (not a literal copy of the author's raw priority integers -- those only ever drove sort ORDER,
  // see app.js), and enabled/meshesignored stay whatever the end-user's own file already had unless
  // the sort screen's own toggle explicitly changed one (enabledOverrides).
  function buildFinalRules(userRules, rankedNames, unrankedNames, enabledOverrides) {
    enabledOverrides = enabledOverrides || {};
    var out = {};
    var total = rankedNames.length;

    function fieldsFor(name) {
      var existing = userRules[name] || {};
      var enabled = Object.prototype.hasOwnProperty.call(enabledOverrides, name)
        ? !!enabledOverrides[name]
        : (existing.enabled !== undefined ? !!existing.enabled : true);
      var meshesignored = existing.meshesignored !== undefined ? !!existing.meshesignored : false;
      return { enabled: enabled, meshesignored: meshesignored };
    }

    rankedNames.forEach(function (name, idx) {
      var f = fieldsFor(name);
      out[name] = { priority: total - idx, enabled: f.enabled, meshesignored: f.meshesignored };
    });
    unrankedNames.forEach(function (name) {
      var f = fieldsFor(name);
      out[name] = { priority: -1, enabled: f.enabled, meshesignored: f.meshesignored };
    });
    return out;
  }

  // Parses an uploaded file's raw text into a modrules.json-shaped object, or throws a plain,
  // user-facing Error -- never lets a raw JSON.parse SyntaxError or a silent wrong-shape reach the
  // UI unexplained.
  function parseModrulesJson(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("That file isn't valid JSON — couldn't read it as a modrules.json file.");
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error("That doesn't look like a modrules.json file (expected an object mapping mod names to their settings).");
    }
    return data;
  }

  return {
    DEFAULT_FUZZY_FLOOR: DEFAULT_FUZZY_FLOOR,
    normalizeName: normalizeName,
    similarity: similarity,
    buildMatchReport: buildMatchReport,
    removeCandidateEverywhere: removeCandidateEverywhere,
    buildFinalRules: buildFinalRules,
    parseModrulesJson: parseModrulesJson,
  };
})();
