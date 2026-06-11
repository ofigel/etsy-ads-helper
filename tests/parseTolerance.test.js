const { test } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const normalize = require("../src/shared/normalize.js");
const domSelectors = require("../src/content/domSelectors.js");
const tableExtractor = require("../src/content/tableExtractor.js");

test("firstNumberIn tolerates label prefixes and currency", () => {
  assert.strictEqual(normalize.firstNumberIn("Spend $1.42"), 1.42);
  assert.strictEqual(normalize.firstNumberIn("US$ 1,234.50"), 1234.5);
  assert.strictEqual(normalize.firstNumberIn("—"), null);
  assert.strictEqual(normalize.firstNumberIn(""), null);
});

test("parseMoney/parseNumber/parsePercent survive prefixed cell text", () => {
  assert.strictEqual(normalize.parseMoney("Spend $6.58"), 6.58);
  assert.strictEqual(normalize.parseNumber("Clicks 23"), 23);
  assert.strictEqual(normalize.parsePercent("Click rate 2.8%"), 0.028);
  assert.strictEqual(normalize.parseNumber("ROAS", { blankAsNull: true }), null);
});

test("visibleText skips screen-reader-only and aria-hidden descendants", () => {
  const doc = new JSDOM(
    `<table><tr><td><span class="wt-screen-reader-only">Spend</span><span aria-hidden="true">ignored</span> $1.42</td></tr></table>`
  ).window.document;
  assert.strictEqual(domSelectors.visibleText(doc.querySelector("td")), "$1.42");
});

test("visibleText falls back to full text when everything is filtered", () => {
  const doc = new JSDOM(
    `<table><tr><td><span aria-hidden="true">$3.81</span></td></tr></table>`
  ).window.document;
  assert.strictEqual(domSelectors.visibleText(doc.querySelector("td")), "$3.81");
});

test("extractRows parses an Etsy-style table with hidden per-cell labels", () => {
  const html = `<table>
    <thead><tr>
      <th><button>Targeted keyword<span class="wt-screen-reader-only">, sort column</span></button></th>
      <th>ROAS</th><th>Orders</th><th><button>Spend</button></th><th>Revenue</th>
      <th>Clicks</th><th>Click rate</th><th>Views</th><th>Relevant keyword</th>
    </tr></thead>
    <tbody>
      <tr>
        <td><span class="wt-screen-reader-only">Targeted keyword</span>cat lover gifts</td>
        <td><span class="wt-screen-reader-only">ROAS</span>0</td>
        <td><span class="wt-screen-reader-only">Orders</span>0</td>
        <td><span class="wt-screen-reader-only">Spend</span>$1.42</td>
        <td><span class="wt-screen-reader-only">Revenue</span>$0</td>
        <td><span class="wt-screen-reader-only">Clicks</span>1</td>
        <td><span class="wt-screen-reader-only">Click rate</span>0.9%</td>
        <td><span class="wt-screen-reader-only">Views</span>106</td>
        <td><input type="checkbox" role="switch" checked></td>
      </tr>
    </tbody>
  </table>`;
  const table = new JSDOM(html).window.document.querySelector("table");
  const { colMap } = tableExtractor.mapColumns(table);
  const rows = tableExtractor.extractRows(table, colMap, "1595713157", 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].keyword_normalized, "cat lover gifts");
  assert.strictEqual(rows[0].spend, 1.42);
  assert.strictEqual(rows[0].clicks, 1);
  assert.strictEqual(rows[0].click_rate, 0.009);
  assert.strictEqual(rows[0].views, 106);
  assert.strictEqual(rows[0].currently_enabled, true);
});

test("even unfiltered label text in cells still parses via firstNumberIn", () => {
  // Worst case: labels are plain (not hidden) text — numbers still extracted.
  const html = `<table>
    <thead><tr><th>Targeted keyword</th><th>Spend</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead>
    <tbody><tr>
      <td>cat guitar shirt</td><td>Spend $1.51</td><td>Clicks 2</td><td>Views 15</td>
      <td><input type="checkbox" checked></td>
    </tr></tbody>
  </table>`;
  const table = new JSDOM(html).window.document.querySelector("table");
  const { colMap } = tableExtractor.mapColumns(table);
  const rows = tableExtractor.extractRows(table, colMap, "1", 1);
  assert.strictEqual(rows[0].spend, 1.51);
  assert.strictEqual(rows[0].clicks, 2);
  assert.strictEqual(rows[0].views, 15);
});
