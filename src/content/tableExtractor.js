/**
 * Header-based column mapping and row parsing for the keywords table.
 * SPEC §11. Never uses fixed cell indexes; re-queries rows fresh per call.
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.domSelectors) ||
      (typeof require === "function" ? require("./domSelectors.js") : null),
    (root.EAKM && root.EAKM.normalize) ||
      (typeof require === "function" ? require("../shared/normalize.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.tableExtractor = mod;
})(globalThis, function (domSelectors, normalize) {
  "use strict";

  const COLUMN_PATTERNS = {
    keyword: /^targeted keyword/,
    roas: /^roas/,
    orders: /^orders/,
    spend: /^spend/,
    revenue: /^revenue/,
    clicks: /^clicks/,
    clickRate: /^click rate/,
    views: /^views/,
    relevant: /^relevant keyword/,
  };

  /**
   * Build {colName: cellIndex} from the header row.
   * Throws {code:"COLUMN_MAPPING_FAILED"} if keyword or relevant is missing.
   * Other missing columns → listed in .warnings, fields parse as null.
   */
  function mapColumns(table) {
    const headers = domSelectors
      .headerCellsOf(table)
      .map((c) => domSelectors.normalizeHeaderText(domSelectors.visibleText(c)));
    const colMap = {};
    const warnings = [];
    for (const [name, re] of Object.entries(COLUMN_PATTERNS)) {
      const idx = headers.findIndex((h) => re.test(h));
      if (idx >= 0) colMap[name] = idx;
      else {
        colMap[name] = null;
        warnings.push(`Column not found: ${name}`);
      }
    }
    if (colMap.keyword == null || colMap.relevant == null) {
      const err = new Error(
        "COLUMN_MAPPING_FAILED: required columns missing (headers: " +
          headers.join(" | ") +
          ")"
      );
      err.code = "COLUMN_MAPPING_FAILED";
      throw err;
    }
    return { colMap, headers, warnings };
  }

  function cellsOf(row) {
    if (row.cells && row.cells.length) return [...row.cells];
    return [...row.querySelectorAll('[role="cell"], td, th')];
  }

  function cellText(cells, idx) {
    if (idx == null || idx >= cells.length) return null;
    // visibleText skips Etsy's hidden per-cell labels ("Spend $1.42" → "$1.42")
    return domSelectors.visibleText(cells[idx]);
  }

  /**
   * Parse all rows on the current page into KeywordRecord-shaped objects
   * (SPEC §15). pageIndex is 1-based, diagnostics only — never identity.
   */
  function extractRows(table, colMap, listingId, pageIndex) {
    const rows = domSelectors.bodyRowsOf(table);
    const records = [];
    rows.forEach((row, rowIndex) => {
      const cells = cellsOf(row);
      const rawKeyword = cellText(cells, colMap.keyword);
      if (!rawKeyword) return; // skeleton/placeholder row

      const toggle = domSelectors.findRowToggle(row);
      const state = toggle ? domSelectors.readToggleState(toggle.el) : null;

      const spendRaw = cellText(cells, colMap.spend);
      const roasRaw = cellText(cells, colMap.roas);
      records.push({
        key: normalize.keywordKey(listingId, rawKeyword),
        keyword_normalized: normalize.keyword_normalization(rawKeyword),
        keyword_raw: rawKeyword,
        raw_variants: [rawKeyword],
        roas: normalize.parseNumber(roasRaw, { blankAsNull: true }),
        roas_raw: roasRaw,
        orders: normalize.parseNumber(cellText(cells, colMap.orders)),
        spend: normalize.parseMoney(spendRaw),
        spend_raw: spendRaw,
        revenue: normalize.parseMoney(cellText(cells, colMap.revenue)),
        clicks: normalize.parseNumber(cellText(cells, colMap.clicks)),
        click_rate: normalize.parsePercent(cellText(cells, colMap.clickRate)),
        views: normalize.parseNumber(cellText(cells, colMap.views)),
        currently_enabled: state === null ? null : state,
        toggle_state_readable: state !== null,
        page_index: pageIndex,
        row_index: rowIndex,
      });
    });
    return records;
  }

  /**
   * Merge a page of records into an accumulating Map keyed by normalized key.
   * Collision rule (SPEC §12): merge stats by max(), collect raw variants,
   * flag had_collision.
   */
  function mergeRecords(accMap, records) {
    let collisions = 0;
    for (const rec of records) {
      const existing = accMap.get(rec.key);
      if (!existing) {
        accMap.set(rec.key, rec);
        continue;
      }
      collisions++;
      existing.had_collision = true;
      if (!existing.raw_variants.includes(rec.keyword_raw)) {
        existing.raw_variants.push(rec.keyword_raw);
      }
      for (const f of ["orders", "spend", "revenue", "clicks", "click_rate", "views"]) {
        existing[f] = Math.max(existing[f] || 0, rec[f] || 0);
      }
      existing.roas =
        existing.roas == null ? rec.roas : rec.roas == null ? existing.roas : Math.max(existing.roas, rec.roas);
      // Enabled state: prefer a readable state; if both readable, OR them
      // (treat as enabled if any variant row is enabled).
      if (rec.currently_enabled !== null) {
        existing.currently_enabled =
          existing.currently_enabled === null
            ? rec.currently_enabled
            : existing.currently_enabled || rec.currently_enabled;
        existing.toggle_state_readable = true;
      }
    }
    return collisions;
  }

  /**
   * Content hash of the visible page used for pagination settle detection
   * (SPEC §22): first + last row keyword text + row count.
   */
  function pageContentHash(table) {
    const rows = domSelectors.bodyRowsOf(table);
    if (!rows.length) return "empty:0";
    const first = (rows[0].textContent || "").trim().slice(0, 80);
    const last = (rows[rows.length - 1].textContent || "").trim().slice(0, 80);
    return rows.length + "::" + first + "::" + last;
  }

  return { COLUMN_PATTERNS, mapColumns, extractRows, mergeRecords, pageContentHash, cellsOf };
});
