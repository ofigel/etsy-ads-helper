const { test } = require("node:test");
const assert = require("node:assert");
const schemas = require("../src/shared/schemas.js");

const LISTING = "4467357077";

function validFile(overrides = {}) {
  return Object.assign(
    {
      schema_version: 1,
      listing_id: LISTING,
      results: [
        { keyword: "america 250 shirt", classification: "KEEP" },
        { keyword: "western shirts", classification: "DISABLE_BROAD", reason: "generic" },
      ],
    },
    overrides
  );
}

test("rejects non-JSON string", () => {
  const r = schemas.validateAiResults("{nope", LISTING);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /not parseable/);
});

test("rejects missing schema_version / listing_id / empty results, listing all errors", () => {
  const r = schemas.validateAiResults({ results: [] }, LISTING);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);
});

test("rejects items missing keyword or classification", () => {
  const r = schemas.validateAiResults(
    validFile({ results: [{ classification: "KEEP" }, { keyword: "x" }] }),
    LISTING
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 2);
});

test("hard gate: listing_id mismatch blocks everything", () => {
  const r = schemas.validateAiResults(validFile({ listing_id: "999" }), LISTING);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "LISTING_ID_MISMATCH");
});

test("unknown classification coerced to REVIEW and flagged", () => {
  const r = schemas.validateAiResults(
    validFile({ results: [{ keyword: "a", classification: "DELETE_NOW" }, { keyword: "b", classification: "weird" }] }),
    LISTING
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.results.length, 2);
  for (const item of r.results) {
    assert.strictEqual(item.classification, "REVIEW");
    assert.strictEqual(item.coerced, true);
  }
});

test("duplicate keyword: last one wins, flagged", () => {
  const r = schemas.validateAiResults(
    validFile({
      results: [
        { keyword: "usa shirt", classification: "KEEP" },
        { keyword: "USA  Shirt", classification: "DISABLE_BROAD" },
      ],
    }),
    LISTING
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].classification, "DISABLE_BROAD");
  assert.strictEqual(r.results[0].duplicate_replaced, true);
});

test("reason longer than 300 chars truncated", () => {
  const r = schemas.validateAiResults(
    validFile({ results: [{ keyword: "a", classification: "KEEP", reason: "x".repeat(400) }] }),
    LISTING
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.results[0].reason.length, 300);
  assert.strictEqual(r.results[0].truncated, true);
});

test("keywords normalized for matching (entity form matches plain form)", () => {
  const snapshot = {
    schema_version: 1,
    listing_id: LISTING,
    keywords: [
      { keyword_normalized: "women's 4th of july shirt", spend: 0 },
      { keyword_normalized: "usa shirt", spend: 5.8 },
    ],
  };
  const r = schemas.validateAiResults(
    validFile({ results: [{ keyword: "women&#39;s 4th of july shirt", classification: "KEEP" }] }),
    LISTING
  );
  const match = schemas.matchAgainstSnapshot(r.results, snapshot);
  assert.strictEqual(match.matched.length, 1);
  assert.strictEqual(match.unmatched_in_ai.length, 0);
  assert.strictEqual(match.not_covered_in_snapshot, 1);
});

test("unmatched AI keywords reported", () => {
  const snapshot = { schema_version: 1, listing_id: LISTING, keywords: [] };
  const r = schemas.validateAiResults(validFile(), LISTING);
  const match = schemas.matchAgainstSnapshot(r.results, snapshot);
  assert.strictEqual(match.matched.length, 0);
  assert.strictEqual(match.unmatched_in_ai.length, 2);
});
