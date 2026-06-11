const { test, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const domSelectors = require("../src/content/domSelectors.js");
const tableExtractor = require("../src/content/tableExtractor.js");

const LISTING = "4467357077";
let doc;

before(() => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "listing-stats-page.html"),
    "utf-8"
  );
  doc = new JSDOM(html).window.document;
});

test("finds the keywords table via header match", () => {
  const found = domSelectors.findKeywordsTable(doc);
  assert.ok(found);
  assert.strictEqual(found.via, "header-match");
});

test("parses expected keyword count from heading", () => {
  assert.strictEqual(domSelectors.findExpectedKeywordCount(doc), 706);
});

test("maps columns by header text, not index", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const { colMap, warnings } = tableExtractor.mapColumns(table);
  assert.strictEqual(colMap.keyword, 0);
  assert.strictEqual(colMap.spend, 3);
  assert.strictEqual(colMap.relevant, 8);
  assert.deepStrictEqual(warnings, []);
});

test("extracts rows with parsed values and toggle state", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const { colMap } = tableExtractor.mapColumns(table);
  const rows = tableExtractor.extractRows(table, colMap, LISTING, 1);
  assert.strictEqual(rows.length, 6);

  const first = rows[0];
  assert.strictEqual(first.keyword_normalized, "america 250 shirt");
  assert.strictEqual(first.key, LISTING + "::america 250 shirt");
  assert.strictEqual(first.roas, 1.51);
  assert.strictEqual(first.orders, 1);
  assert.strictEqual(first.spend, 18.52);
  assert.strictEqual(first.revenue, 27.99);
  assert.strictEqual(first.clicks, 23);
  assert.strictEqual(first.click_rate, 0.023);
  assert.strictEqual(first.views, 985);
  assert.strictEqual(first.currently_enabled, true);

  // Entity-encoded keyword from real Etsy markup.
  const women = rows.find((r) => r.keyword_normalized === "women's 4th of july shirt");
  assert.ok(women);
  assert.strictEqual(women.roas, null); // blank ROAS → null

  // Disabled toggle read correctly.
  const wtf = rows.find((r) => r.keyword_normalized === "wtf is a kilometer shirt");
  assert.strictEqual(wtf.currently_enabled, false);
});

test("collision merge: stats by max, raw variants collected", () => {
  const acc = new Map();
  const a = {
    key: "1::usa shirt", keyword_normalized: "usa shirt", keyword_raw: "usa shirt",
    raw_variants: ["usa shirt"], roas: null, orders: 0, spend: 2, revenue: 0,
    clicks: 3, click_rate: 0.01, views: 10, currently_enabled: null, toggle_state_readable: false,
  };
  const b = {
    key: "1::usa shirt", keyword_normalized: "usa shirt", keyword_raw: "USA  Shirt",
    raw_variants: ["USA  Shirt"], roas: 1.2, orders: 1, spend: 1, revenue: 5,
    clicks: 7, click_rate: 0.02, views: 4, currently_enabled: true, toggle_state_readable: true,
  };
  const collisions = tableExtractor.mergeRecords(acc, [a, b]);
  assert.strictEqual(collisions, 1);
  const merged = acc.get("1::usa shirt");
  assert.strictEqual(merged.had_collision, true);
  assert.strictEqual(merged.spend, 2);
  assert.strictEqual(merged.clicks, 7);
  assert.strictEqual(merged.roas, 1.2);
  assert.strictEqual(merged.currently_enabled, true);
  assert.deepStrictEqual(merged.raw_variants, ["usa shirt", "USA  Shirt"]);
});

test("page content hash changes with content", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const h1 = tableExtractor.pageContentHash(table);
  assert.match(h1, /^6::/);
  const cell = table.querySelector("tbody tr td");
  const old = cell.textContent;
  cell.textContent = "something else entirely";
  assert.notStrictEqual(tableExtractor.pageContentHash(table), h1);
  cell.textContent = old;
});

test("pagination detection: total pages, current page, next/prev", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const p = domSelectors.findPagination(table);
  assert.ok(p);
  assert.strictEqual(domSelectors.readPagesTotal(p), 48);
  assert.strictEqual(domSelectors.readCurrentPage(p), 1);
  assert.ok(p.next);
  assert.ok(p.prev);
  assert.strictEqual(domSelectors.isDisabledControl(p.prev), true);
  assert.strictEqual(domSelectors.isDisabledControl(p.next), false);
});

test("toggle detection prefers checkbox in the last cell", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const rows = domSelectors.bodyRowsOf(table);
  const t = domSelectors.findRowToggle(rows[0]);
  assert.ok(t);
  assert.strictEqual(t.kind, "checkbox");
  assert.strictEqual(domSelectors.readToggleState(t.el), true);
});

test("missing required column throws COLUMN_MAPPING_FAILED", () => {
  const dom = new JSDOM(
    "<table><thead><tr><th>Spend</th><th>Clicks</th></tr></thead><tbody></tbody></table>"
  );
  const table = dom.window.document.querySelector("table");
  assert.throws(() => tableExtractor.mapColumns(table), (e) => e.code === "COLUMN_MAPPING_FAILED");
});

test("Spend sort control found in header", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const ctrl = domSelectors.findSpendSortControl(table);
  assert.ok(ctrl);
  assert.strictEqual(ctrl.tagName, "BUTTON");
});
