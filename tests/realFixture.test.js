const { test, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const domSelectors = require("../src/content/domSelectors.js");
const tableExtractor = require("../src/content/tableExtractor.js");
const toggleDriver = require("../src/content/toggleDriver.js");

// fixtures/real-table-fragment.html is REAL Etsy markup captured 2026-06-12
// (listing 4457419631, pagination page 2, trimmed to 3 rows).
let doc;

before(() => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "real-table-fragment.html"),
    "utf-8"
  );
  doc = new JSDOM(html).window.document;
});

test("real markup: keywords table found via header match", () => {
  const found = domSelectors.findKeywordsTable(doc);
  assert.ok(found);
  assert.strictEqual(found.via, "header-match");
});

test("real markup: expected count parsed from accordion title", () => {
  assert.strictEqual(domSelectors.findExpectedKeywordCount(doc), 58);
});

test("real markup: column mapping (keyword in th[scope=row], labels in cells)", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const { colMap, warnings } = tableExtractor.mapColumns(table);
  assert.strictEqual(colMap.keyword, 0);
  assert.strictEqual(colMap.spend, 3);
  assert.strictEqual(colMap.relevant, 8);
  assert.deepStrictEqual(warnings, []);
});

test("real markup: rows extract with clean keywords and numeric stats", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const { colMap } = tableExtractor.mapColumns(table);
  const rows = tableExtractor.extractRows(table, colMap, "4457419631", 2);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(
    rows.map((r) => r.keyword_normalized),
    ["japanese clothing", "japanese tshirt", "streetwear"]
  );
  for (const r of rows) {
    assert.ok(!/targeted keyword/i.test(r.keyword_normalized), "label prefix leaked: " + r.keyword_normalized);
    assert.strictEqual(r.spend, 0);
    assert.strictEqual(typeof r.views, "number");
    assert.strictEqual(r.toggle_state_readable, true);
  }
});

test("real markup: toggle is the wt-switch checkbox, state readable", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const rows = domSelectors.bodyRowsOf(table);
  const t = domSelectors.findRowToggle(rows[0]);
  assert.ok(t);
  assert.strictEqual(t.kind, "checkbox");
  assert.notStrictEqual(domSelectors.readToggleState(t.el), null);
});

test("real markup: toggleDriver finds a row by normalized keyword", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const { colMap } = tableExtractor.mapColumns(table);
  const found = toggleDriver.findKeywordRow(table, colMap, "japanese tshirt");
  assert.ok(found);
  assert.ok(found.toggle);
});

test("real markup: pagination — current page 2, prev/next present", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const p = domSelectors.findPagination(table);
  assert.ok(p);
  assert.strictEqual(domSelectors.readCurrentPage(p), 2);
  assert.ok(p.prev, "prev button (screen-reader label 'Previous')");
  assert.ok(domSelectors.readPagesTotal(p) >= 4);
});

test("real markup: Spend sort control is the sadx-clickable header button", () => {
  const { table } = domSelectors.findKeywordsTable(doc);
  const controls = domSelectors.findSpendSortControls(table);
  assert.ok(controls.length >= 1);
  assert.strictEqual(controls[0].tagName, "BUTTON");
  assert.match(controls[0].className, /sadx-clickable/);
});

test("real markup: listing thumb selector skips site-asset icons", () => {
  const hit = domSelectors.resolve("listingThumb", doc);
  assert.ok(hit);
  assert.match(hit.el.getAttribute("src"), /\/il\//);
  assert.doesNotMatch(hit.el.getAttribute("src"), /site-assets/);
});
