const { test } = require("node:test");
const assert = require("node:assert");
const classification = require("../src/shared/classification.js");
const { DEFAULT_SETTINGS } = require("../src/shared/storageKeys.js");

const S = DEFAULT_SETTINGS;

test("prelabel: profitable keyword → KEEP", () => {
  assert.strictEqual(classification.prelabel({ orders: 1, roas: 7.35, spend: 3.81, clicks: 6 }, S), "KEEP");
});

test("prelabel: has sales but below target → REVIEW (never auto-disable)", () => {
  assert.strictEqual(classification.prelabel({ orders: 1, roas: 1.51, spend: 18.52, clicks: 23 }, S), "REVIEW");
  assert.strictEqual(classification.prelabel({ orders: 1, roas: 0.5, spend: 50, clicks: 30 }, S), "REVIEW");
});

test("prelabel: zero orders, high spend, enough clicks → DISABLE_NO_CONVERSION", () => {
  assert.strictEqual(
    classification.prelabel({ orders: 0, roas: 0, spend: 16.48, clicks: 22 }, S),
    "DISABLE_NO_CONVERSION"
  );
});

test("prelabel: zero orders, spend but few clicks → REVIEW", () => {
  assert.strictEqual(classification.prelabel({ orders: 0, roas: 0, spend: 6.58, clicks: 5 }, S), "REVIEW");
});

test("prelabel: zero spend → REVIEW (keep-by-safety)", () => {
  assert.strictEqual(classification.prelabel({ orders: 0, roas: 0, spend: 0, clicks: 0 }, S), "REVIEW");
});

test("safety override: unknown classification can never be actionable", () => {
  const ov = classification.applySafetyOverride({ spend: 100, clicks: 50 }, "NUKE_IT");
  assert.strictEqual(ov.classification, "REVIEW");
  assert.strictEqual(ov.downgraded, true);
  assert.strictEqual(classification.isActionable(ov.classification), false);
});

test("safety override: zero spend + DISABLE_NO_CONVERSION is a contradiction → REVIEW", () => {
  const ov = classification.applySafetyOverride({ spend: 0, clicks: 0 }, "DISABLE_NO_CONVERSION");
  assert.strictEqual(ov.classification, "REVIEW");
  assert.strictEqual(ov.downgraded, true);
  assert.match(ov.note, /contradicts/);
});

test("safety override: zero spend + zero clicks DISABLE_IRRELEVANT allowed but separated", () => {
  const ov = classification.applySafetyOverride({ spend: 0, clicks: 0 }, "DISABLE_IRRELEVANT");
  assert.strictEqual(ov.classification, "DISABLE_IRRELEVANT");
  assert.strictEqual(ov.zero_spend_group, true);
  assert.strictEqual(ov.downgraded, false);
});

test("safety override: normal disable passes through", () => {
  const ov = classification.applySafetyOverride({ spend: 16.48, clicks: 22 }, "DISABLE_NO_CONVERSION");
  assert.strictEqual(ov.classification, "DISABLE_NO_CONVERSION");
  assert.strictEqual(ov.zero_spend_group, false);
  assert.strictEqual(ov.downgraded, false);
});

test("only DISABLE_* values are actionable", () => {
  assert.strictEqual(classification.isActionable("KEEP"), false);
  assert.strictEqual(classification.isActionable("REVIEW"), false);
  assert.strictEqual(classification.isActionable("DISABLE_BROAD"), true);
  assert.strictEqual(classification.isActionable("DISABLE_IRRELEVANT"), true);
  assert.strictEqual(classification.isActionable("DISABLE_NO_CONVERSION"), true);
});
