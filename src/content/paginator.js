/**
 * Pagination driver: wait-for-table, next-page navigation with settle
 * detection, return-to-page-1, and sort-by-Spend-descending. SPEC §10, §22.
 *
 * Element references are never held across awaits longer than one action —
 * the table is re-resolved fresh after every navigation (React re-renders).
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.domSelectors) ||
      (typeof require === "function" ? require("./domSelectors.js") : null),
    (root.EAKM && root.EAKM.tableExtractor) ||
      (typeof require === "function" ? require("./tableExtractor.js") : null),
    (root.EAKM && root.EAKM.normalize) ||
      (typeof require === "function" ? require("../shared/normalize.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.paginator = mod;
})(globalThis, function (domSelectors, tableExtractor, normalize) {
  "use strict";

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Delay with ±30% random jitter (SPEC §29). */
  function jittered(ms) {
    const jitter = ms * 0.3 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(ms + jitter));
  }

  function sleepJittered(ms) {
    return sleep(jittered(ms));
  }

  /**
   * Wait until the keywords table appears (MutationObserver + 250ms debounce).
   * Resolves {table, via}; rejects {code:"TABLE_NOT_FOUND"} on timeout.
   */
  function waitForTable(timeoutMs, doc) {
    const d = doc || document;
    return new Promise((resolve, reject) => {
      const existing = domSelectors.findKeywordsTable(d);
      if (existing) return resolve(existing);

      let debounce = null;
      let done = false;
      const observer = new MutationObserver(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (done) return;
          const found = domSelectors.findKeywordsTable(d);
          if (found) {
            done = true;
            observer.disconnect();
            clearTimeout(killer);
            resolve(found);
          }
        }, 250);
      });
      observer.observe(d.body || d.documentElement, { childList: true, subtree: true });

      const killer = setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        const err = new Error("TABLE_NOT_FOUND: keywords table did not appear in " + timeoutMs + "ms");
        err.code = "TABLE_NOT_FOUND";
        reject(err);
      }, timeoutMs);
    });
  }

  /** Re-resolve the live table element (never cache across navigations). */
  function currentTable(doc) {
    const found = domSelectors.findKeywordsTable(doc || document);
    return found ? found.table : null;
  }

  function userLikeClick(el) {
    const opts = { bubbles: true, cancelable: true, view: globalThis.window || undefined };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
    } catch (e) {
      /* PointerEvent may be unavailable (jsdom) */
    }
    el.click();
  }

  /**
   * Wait until the table content hash differs from beforeHash (or until an
   * expected predicate passes). Polls every 200ms.
   * Rejects {code:"PAGINATION_FAILED"} on timeout.
   */
  async function waitForContentChange(beforeHash, settleTimeoutMs, doc) {
    const start = Date.now();
    while (Date.now() - start < settleTimeoutMs) {
      await sleep(200);
      const table = currentTable(doc);
      if (table) {
        const h = tableExtractor.pageContentHash(table);
        if (h !== beforeHash) {
          // One extra poll cycle to let React finish painting the new rows.
          await sleep(200);
          return currentTable(doc);
        }
      }
    }
    const err = new Error("PAGINATION_FAILED: table content did not change in " + settleTimeoutMs + "ms");
    err.code = "PAGINATION_FAILED";
    throw err;
  }

  /**
   * Click Next and wait for the page to settle.
   * Returns {table, advanced:boolean} — advanced=false means we are on the
   * last page (next disabled/absent).
   */
  async function nextPage(settleTimeoutMs, doc) {
    const table = currentTable(doc);
    if (!table) {
      const err = new Error("PAGINATION_FAILED: table disappeared");
      err.code = "PAGINATION_FAILED";
      throw err;
    }
    const pagination = domSelectors.findPagination(table);
    if (!pagination || !pagination.next || domSelectors.isDisabledControl(pagination.next)) {
      return { table, advanced: false };
    }
    const beforeHash = tableExtractor.pageContentHash(table);
    const beforePage = domSelectors.readCurrentPage(pagination);
    userLikeClick(pagination.next);
    const newTable = await waitForContentChange(beforeHash, settleTimeoutMs, doc);

    // Confirmation only (never navigation): page number should have advanced.
    const afterPagination = domSelectors.findPagination(newTable);
    const afterPage = afterPagination ? domSelectors.readCurrentPage(afterPagination) : null;
    if (beforePage != null && afterPage != null && afterPage <= beforePage) {
      const err = new Error(
        `PAGINATION_FAILED: page number did not advance (${beforePage} → ${afterPage})`
      );
      err.code = "PAGINATION_FAILED";
      throw err;
    }
    return { table: newTable, advanced: true };
  }

  /**
   * Return to page 1: click the "1" button if present, else click prev until
   * disabled. No-op when already there.
   */
  async function gotoFirstPage(settleTimeoutMs, doc) {
    let table = currentTable(doc);
    if (!table) {
      const err = new Error("PAGINATION_FAILED: table not found");
      err.code = "PAGINATION_FAILED";
      throw err;
    }
    let pagination = domSelectors.findPagination(table);
    if (!pagination) return table; // single page, nothing to do
    if (domSelectors.readCurrentPage(pagination) === 1) return table;

    const oneBtn = pagination.pageButtons.find((b) => (b.textContent || "").trim() === "1");
    if (oneBtn && !domSelectors.isDisabledControl(oneBtn)) {
      const beforeHash = tableExtractor.pageContentHash(table);
      userLikeClick(oneBtn);
      return waitForContentChange(beforeHash, settleTimeoutMs, doc);
    }
    for (let guard = 0; guard < 100; guard++) {
      pagination = domSelectors.findPagination(currentTable(doc));
      if (!pagination || !pagination.prev || domSelectors.isDisabledControl(pagination.prev)) break;
      const beforeHash = tableExtractor.pageContentHash(currentTable(doc));
      userLikeClick(pagination.prev);
      table = await waitForContentChange(beforeHash, settleTimeoutMs, doc);
      await sleep(300);
    }
    return currentTable(doc);
  }

  /**
   * First-row vs last-row spend comparison for sort verification.
   * "indeterminate" = every row on the page has the same spend (usually all
   * zeros), which proves nothing about the sort order.
   */
  function spendOrderOnPage(table, colMap) {
    const rows = domSelectors.bodyRowsOf(table);
    if (rows.length < 2) return "single";
    const spendOf = (row) => {
      const cells = tableExtractor.cellsOf(row);
      const idx = colMap.spend;
      if (idx == null || idx >= cells.length) return 0;
      return normalize.parseMoney(cells[idx].textContent);
    };
    const spends = rows.map(spendOf);
    const first = spends[0];
    const last = spends[spends.length - 1];
    if (spends.every((s) => s === first)) return "indeterminate";
    if (first > last) return "desc";
    if (first < last) return "asc";
    return "indeterminate";
  }

  function isSpendSortedDesc(table, colMap) {
    const aria = domSelectors.readSpendSortState(table);
    if (aria === "desc") return true;
    if (aria === "asc") return false;
    const order = spendOrderOnPage(table, colMap);
    if (order === "desc" || order === "single") return true;
    return false;
  }

  /**
   * Sort the table by Spend descending by clicking the Spend header.
   * Tries each clickable candidate inside the header (button/link/role=
   * button/focusable span/the cell itself) until one provokes a change,
   * clicking up to twice per candidate (asc → desc toggling). Verified via
   * aria-sort first, row comparison second.
   * Rejects {code:"SORT_FAILED"} when no candidate produces a verified
   * descending order — callers should fall back to a full crawl.
   */
  async function sortBySpendDesc(colMap, settleTimeoutMs, doc) {
    let table = currentTable(doc);
    if (isSpendSortedDesc(table, colMap)) return table;

    const candidateCount = Math.max(1, domSelectors.findSpendSortControls(table).length);
    for (let ci = 0; ci < candidateCount; ci++) {
      let provoked = false;
      for (let clickNo = 0; clickNo < 2; clickNo++) {
        table = currentTable(doc);
        // Re-resolve fresh on every click — React re-renders the header.
        const controls = domSelectors.findSpendSortControls(table);
        const control = controls[Math.min(ci, controls.length - 1)];
        if (!control) break;

        const beforeHash = tableExtractor.pageContentHash(table);
        const beforeAria = domSelectors.readSpendSortState(table);
        userLikeClick(control);
        try {
          table = await waitForContentChange(beforeHash, settleTimeoutMs, doc);
          provoked = true;
        } catch (e) {
          table = currentTable(doc);
          // Content unchanged, but an aria-sort flip still proves the click landed.
          if (domSelectors.readSpendSortState(table) !== beforeAria) provoked = true;
        }
        if (isSpendSortedDesc(table, colMap)) return table;
        await sleep(400);
      }
      // This candidate provoked changes but never reached desc — clicking
      // others would just keep toggling; bail out to the fallback path.
      if (provoked) break;
    }
    const err = new Error("SORT_FAILED: could not establish Spend descending order");
    err.code = "SORT_FAILED";
    throw err;
  }

  return {
    sleep,
    jittered,
    sleepJittered,
    waitForTable,
    currentTable,
    userLikeClick,
    waitForContentChange,
    nextPage,
    gotoFirstPage,
    sortBySpendDesc,
    spendOrderOnPage,
    isSpendSortedDesc,
  };
});
