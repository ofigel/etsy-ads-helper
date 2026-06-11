const { test } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const domSelectors = require("../src/content/domSelectors.js");
const paginator = require("../src/content/paginator.js");
const tableExtractor = require("../src/content/tableExtractor.js");

function tableFrom(html) {
  return new JSDOM(html).window.document.querySelector("table");
}

const HEAD = `<tr><th>Targeted keyword</th><th>Spend</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr>`;
function row(kw, spend) {
  return `<tr><td>${kw}</td><td>${spend}</td><td>1</td><td>5</td><td><input type="checkbox" checked></td></tr>`;
}

test("readSpendSortState: aria-sort on th wins", () => {
  const t = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th aria-sort="descending">Spend</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody></tbody></table>`);
  assert.strictEqual(domSelectors.readSpendSortState(t), "desc");
});

test("readSpendSortState: aria-sort on a descendant", () => {
  const t = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th><button aria-sort="ascending">Spend</button></th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody></tbody></table>`);
  assert.strictEqual(domSelectors.readSpendSortState(t), "asc");
});

test("readSpendSortState: arrow glyph fallback", () => {
  const t = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th>Spend ▾</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody></tbody></table>`);
  assert.strictEqual(domSelectors.readSpendSortState(t), "desc");
});

test("readSpendSortState: unknown when no signal", () => {
  const t = tableFrom(`<table><thead>${HEAD}</thead><tbody></tbody></table>`);
  assert.strictEqual(domSelectors.readSpendSortState(t), null);
});

test("findSpendSortControls: specific controls first, th last", () => {
  const t = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th><button>Spend</button></th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody></tbody></table>`);
  const controls = domSelectors.findSpendSortControls(t);
  assert.ok(controls.length >= 2);
  assert.strictEqual(controls[0].tagName, "BUTTON");
  assert.strictEqual(controls[controls.length - 1].tagName, "TH");
});

test("findSpendSortControls: bare th is still clickable candidate", () => {
  const t = tableFrom(`<table><thead>${HEAD}</thead><tbody></tbody></table>`);
  const controls = domSelectors.findSpendSortControls(t);
  assert.strictEqual(controls.length, 1);
  assert.strictEqual(controls[0].tagName, "TH");
});

test("spendOrderOnPage: descending detected", () => {
  const t = tableFrom(`<table><thead>${HEAD}</thead><tbody>${row("a", "$18.52")}${row("b", "$3.38")}</tbody></table>`);
  const { colMap } = tableExtractor.mapColumns(t);
  assert.strictEqual(paginator.spendOrderOnPage(t, colMap), "desc");
});

test("spendOrderOnPage: all-equal page is indeterminate, not flat-failure", () => {
  const t = tableFrom(`<table><thead>${HEAD}</thead><tbody>${row("a", "$0")}${row("b", "$0")}${row("c", "$0")}</tbody></table>`);
  const { colMap } = tableExtractor.mapColumns(t);
  assert.strictEqual(paginator.spendOrderOnPage(t, colMap), "indeterminate");
});

test("isSpendSortedDesc: aria-sort overrides row reading", () => {
  const asc = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th aria-sort="ascending">Spend</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody>${row("a", "$9")}${row("b", "$1")}</tbody></table>`);
  const { colMap } = tableExtractor.mapColumns(asc);
  assert.strictEqual(paginator.isSpendSortedDesc(asc, colMap), false);

  const desc = tableFrom(`<table><thead><tr><th>Targeted keyword</th><th aria-sort="descending">Spend</th><th>Clicks</th><th>Views</th><th>Relevant keyword</th></tr></thead><tbody>${row("a", "$0")}${row("b", "$0")}</tbody></table>`);
  assert.strictEqual(paginator.isSpendSortedDesc(desc, colMap), true);
});

test("isSpendSortedDesc: rows decide when no aria signal", () => {
  const t = tableFrom(`<table><thead>${HEAD}</thead><tbody>${row("a", "$18.52")}${row("b", "$3.38")}</tbody></table>`);
  const { colMap } = tableExtractor.mapColumns(t);
  assert.strictEqual(paginator.isSpendSortedDesc(t, colMap), true);
});
