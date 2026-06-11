const { test } = require("node:test");
const assert = require("node:assert");
const csv = require("../src/shared/csv.js");

test("escapes quotes, commas and newlines", () => {
  assert.strictEqual(csv.escapeField('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csv.escapeField("a,b"), '"a,b"');
  assert.strictEqual(csv.escapeField("a\nb"), '"a\nb"');
  assert.strictEqual(csv.escapeField("plain"), "plain");
  assert.strictEqual(csv.escapeField(null), "");
});

test("keywordsToCsv produces header + rows with CRLF", () => {
  const out = csv.keywordsToCsv([
    {
      keyword_normalized: "women's 4th of july shirt",
      roas: null,
      orders: 0,
      spend: 0,
      revenue: 0,
      clicks: 0,
      click_rate: 0,
      views: 14,
      currently_enabled: true,
      prelabel: "REVIEW",
    },
  ]);
  const lines = out.split("\r\n");
  assert.strictEqual(
    lines[0],
    "keyword,roas,orders,spend,revenue,clicks,click_rate,views,currently_enabled,prelabel"
  );
  assert.strictEqual(lines[1], "women's 4th of july shirt,,0,0,0,0,0,14,true,REVIEW");
});
