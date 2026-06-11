const { test } = require("node:test");
const assert = require("node:assert");
const normalize = require("../src/shared/normalize.js");

const N = normalize.keyword_normalization;

test("decodes numeric HTML entities (real Etsy case)", () => {
  assert.strictEqual(N("women&#39;s 4th of july shirt"), "women's 4th of july shirt");
});

test("decodes named entities", () => {
  assert.strictEqual(N("cats &amp; dogs shirt"), "cats & dogs shirt");
});

test("entity-encoded and plain forms normalize identically", () => {
  assert.strictEqual(N("women&#39;s 4th of july shirt"), N("women's 4th of july shirt"));
});

test("apostrophe forms stay DISTINCT from apostrophe-less forms", () => {
  assert.notStrictEqual(N("women's 4th of july shirt"), N("womens 4th of july shirt"));
});

test("curly apostrophes become ASCII", () => {
  assert.strictEqual(N("women’s shirt"), "women's shirt");
  assert.strictEqual(N("women‘s shirt"), "women's shirt");
  assert.strictEqual(N("womenʼs shirt"), "women's shirt");
});

test("NBSP collapses to regular space", () => {
  assert.strictEqual(N("usa\u00A0shirt"), "usa shirt");
});

test("zero-width chars and soft hyphen are stripped", () => {
  assert.strictEqual(N("usa\u200Bshirt\u00AD\uFEFF"), "usashirt");
  assert.strictEqual(N("a\u200C\u200D\u2060b"), "ab");
});

test("lowercases and collapses internal whitespace", () => {
  assert.strictEqual(N("  USA   250\t Shirt \n"), "usa 250 shirt");
});

test("null/undefined → empty string", () => {
  assert.strictEqual(N(null), "");
  assert.strictEqual(N(undefined), "");
});

test("keywordKey builds listing-scoped identity", () => {
  assert.strictEqual(
    normalize.keywordKey("4467357077", "USA Shirt"),
    "4467357077::usa shirt"
  );
});

test("parseMoney", () => {
  assert.strictEqual(normalize.parseMoney("$513.52"), 513.52);
  assert.strictEqual(normalize.parseMoney("$1,234.50"), 1234.5);
  assert.strictEqual(normalize.parseMoney("—"), 0);
  assert.strictEqual(normalize.parseMoney(""), 0);
});

test("parsePercent", () => {
  assert.strictEqual(normalize.parsePercent("2.8%"), 0.028);
  assert.strictEqual(normalize.parsePercent("0%"), 0);
});

test("parseNumber with blankAsNull for ROAS", () => {
  assert.strictEqual(normalize.parseNumber("1,234"), 1234);
  assert.strictEqual(normalize.parseNumber("", { blankAsNull: true }), null);
  assert.strictEqual(normalize.parseNumber(""), 0);
});
