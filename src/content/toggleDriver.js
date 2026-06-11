/**
 * Toggle driver: locate, click and verify keyword relevance switches.
 * The ONLY module that mutates the Etsy page. SPEC §28.
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.domSelectors) ||
      (typeof require === "function" ? require("./domSelectors.js") : null),
    (root.EAKM && root.EAKM.paginator) ||
      (typeof require === "function" ? require("./paginator.js") : null),
    (root.EAKM && root.EAKM.normalize) ||
      (typeof require === "function" ? require("../shared/normalize.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.toggleDriver = mod;
})(globalThis, function (domSelectors, paginator, normalize) {
  "use strict";

  /**
   * Find the row for a normalized keyword on the current page.
   * Returns {row, toggle, state} or null. Always works on fresh DOM.
   */
  function findKeywordRow(table, colMap, keywordNormalized) {
    const rows = domSelectors.bodyRowsOf(table);
    for (const row of rows) {
      const cells = row.cells ? [...row.cells] : [...row.querySelectorAll('[role="cell"], td')];
      const idx = colMap.keyword;
      if (idx == null || idx >= cells.length) continue;
      // Same extraction as the exporter, so identities always agree.
      const raw = domSelectors.visibleText(cells[idx]);
      if (normalize.keyword_normalization(raw) === keywordNormalized) {
        const toggle = domSelectors.findRowToggle(row);
        return {
          row,
          toggle: toggle ? toggle.el : null,
          state: toggle ? domSelectors.readToggleState(toggle.el) : null,
        };
      }
    }
    return null;
  }

  /**
   * Click a toggle and verify it flipped to `expectedState` by polling every
   * 150ms up to verifyTimeoutMs. On timeout, ONE retry with a freshly
   * re-found toggle. Returns {ok, retried, finalState}.
   */
  async function clickAndVerify(table, colMap, keywordNormalized, expectedState, verifyTimeoutMs) {
    let retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Re-find fresh from DOM on every attempt (React re-renders).
      const liveTable = paginator.currentTable() || table;
      const found = findKeywordRow(liveTable, colMap, keywordNormalized);
      if (!found || !found.toggle) {
        return { ok: false, retried, finalState: null, error: "toggle-not-found" };
      }
      if (found.state === expectedState) {
        return { ok: true, retried, finalState: found.state, alreadyInState: true };
      }
      paginator.userLikeClick(found.toggle);

      const start = Date.now();
      while (Date.now() - start < verifyTimeoutMs) {
        await paginator.sleep(150);
        const t = paginator.currentTable() || liveTable;
        const check = findKeywordRow(t, colMap, keywordNormalized);
        if (check && check.state === expectedState) {
          return { ok: true, retried, finalState: check.state };
        }
      }
      retried = true;
    }
    return { ok: false, retried, finalState: null, error: "verify-timeout" };
  }

  return { findKeywordRow, clickAndVerify };
});
