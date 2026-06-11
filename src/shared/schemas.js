/**
 * JSON schema validators for export snapshots and AI result files.
 * SPEC §15–§17. Hand-rolled validation (no external schema lib).
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.normalize) ||
      (typeof require === "function" ? require("./normalize.js") : null),
    (root.EAKM && root.EAKM.classification) ||
      (typeof require === "function" ? require("./classification.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.schemas = mod;
})(globalThis, function (normalize, classification) {
  "use strict";

  const SUPPORTED_AI_SCHEMA_VERSIONS = [1];
  const MAX_REASON_LENGTH = 300;

  /**
   * Validate ai_results.json content (already-parsed object or raw string).
   * SPEC §17. Returns:
   *   { ok, errors[], results[] }  — results only when ok.
   * File-level errors reject the whole file. Per-item soft issues are
   * recorded on the item ({coerced, duplicate_of_replaced, truncated}).
   */
  function validateAiResults(input, activeListingId) {
    const errors = [];
    let data = input;

    if (typeof input === "string") {
      try {
        data = JSON.parse(input);
      } catch (e) {
        return { ok: false, errors: ["File is not parseable JSON: " + e.message], results: [] };
      }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, errors: ["Top level must be a JSON object"], results: [] };
    }

    if (data.schema_version == null) {
      errors.push("Missing schema_version");
    } else if (!SUPPORTED_AI_SCHEMA_VERSIONS.includes(data.schema_version)) {
      errors.push("Unsupported schema_version: " + String(data.schema_version));
    }

    if (data.listing_id == null || String(data.listing_id).trim() === "") {
      errors.push("Missing listing_id");
    }

    if (!Array.isArray(data.results) || data.results.length === 0) {
      errors.push("results must be a non-empty array");
    } else {
      data.results.forEach((item, i) => {
        if (!item || typeof item !== "object") {
          errors.push(`results[${i}] is not an object`);
          return;
        }
        if (item.keyword == null || String(item.keyword).trim() === "") {
          errors.push(`results[${i}] missing keyword`);
        }
        if (item.classification == null) {
          errors.push(`results[${i}] missing classification`);
        } else if (typeof item.classification !== "string") {
          errors.push(`results[${i}] classification is not a string`);
        }
      });
    }

    if (errors.length) return { ok: false, errors, results: [] };

    // Hard gate: listing mismatch blocks the whole import (LISTING_ID_MISMATCH).
    if (activeListingId != null && String(data.listing_id) !== String(activeListingId)) {
      return {
        ok: false,
        code: "LISTING_ID_MISMATCH",
        errors: [
          `listing_id mismatch: file is for ${data.listing_id}, active snapshot is ${activeListingId}`,
        ],
        results: [],
      };
    }

    // Per-item soft handling: normalize, coerce unknown classes, dedupe (last wins).
    const byKeyword = new Map();
    for (const item of data.results) {
      const kwNorm = normalize.keyword_normalization(item.keyword);
      let cls = item.classification;
      let coerced = false;
      if (!classification.isKnownClassification(cls)) {
        cls = "REVIEW";
        coerced = true;
      }
      let reason = item.reason == null ? "" : String(item.reason);
      let truncated = false;
      if (reason.length > MAX_REASON_LENGTH) {
        reason = reason.slice(0, MAX_REASON_LENGTH);
        truncated = true;
      }
      const result = {
        keyword_normalized: kwNorm,
        keyword_raw: String(item.keyword),
        classification: cls,
        reason,
        coerced,
        truncated,
        duplicate_replaced: byKeyword.has(kwNorm),
      };
      byKeyword.set(kwNorm, result); // last one wins
    }

    return {
      ok: true,
      errors: [],
      listing_id: String(data.listing_id),
      results: [...byKeyword.values()],
    };
  }

  /**
   * Match validated AI results against a snapshot (SPEC §17 match report).
   * Returns {matched[], unmatched_in_ai[], not_covered_in_snapshot}.
   */
  function matchAgainstSnapshot(results, snapshot) {
    const snapByNorm = new Map(
      (snapshot.keywords || []).map((k) => [k.keyword_normalized, k])
    );
    const matched = [];
    const unmatchedInAi = [];
    const coveredNorms = new Set();

    for (const r of results) {
      const snapKw = snapByNorm.get(r.keyword_normalized);
      if (snapKw) {
        matched.push({ ai: r, keyword: snapKw });
        coveredNorms.add(r.keyword_normalized);
      } else {
        unmatchedInAi.push(r);
      }
    }
    return {
      matched,
      unmatched_in_ai: unmatchedInAi,
      not_covered_in_snapshot: (snapshot.keywords || []).length - coveredNorms.size,
    };
  }

  /** Minimal sanity check of a stored snapshot before use. */
  function isValidSnapshot(snap) {
    return Boolean(
      snap &&
        typeof snap === "object" &&
        snap.schema_version === 1 &&
        typeof snap.listing_id === "string" &&
        Array.isArray(snap.keywords)
    );
  }

  return {
    SUPPORTED_AI_SCHEMA_VERSIONS,
    MAX_REASON_LENGTH,
    validateAiResults,
    matchAgainstSnapshot,
    isValidSnapshot,
  };
});
