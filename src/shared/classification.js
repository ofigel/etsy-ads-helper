/**
 * Classification enum, profitability pre-labeling and hard safety overrides.
 * SPEC §19–§21.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.classification = mod;
})(globalThis, function () {
  "use strict";

  const CLASSIFICATIONS = [
    "KEEP",
    "REVIEW",
    "DISABLE_BROAD",
    "DISABLE_IRRELEVANT",
    "DISABLE_NO_CONVERSION",
  ];

  const ACTIONABLE = new Set([
    "DISABLE_BROAD",
    "DISABLE_IRRELEVANT",
    "DISABLE_NO_CONVERSION",
  ]);

  function isKnownClassification(value) {
    return typeof value === "string" && CLASSIFICATIONS.includes(value);
  }

  function isActionable(value) {
    return ACTIONABLE.has(value);
  }

  /**
   * Advisory prelabel embedded into the export for the AI (SPEC §20).
   * kw: {orders, roas, spend, clicks}; settings: §33 object.
   */
  function prelabel(kw, settings) {
    const orders = kw.orders || 0;
    const roas = kw.roas == null ? 0 : kw.roas;
    const spend = kw.spend || 0;
    const clicks = kw.clicks || 0;

    if (orders > 0 && roas >= settings.target_min_roas) return "KEEP";
    if (orders > 0) return "REVIEW"; // unprofitable or between break-even and target
    if (spend === 0) return "REVIEW"; // keep-by-safety (§21)
    if (
      spend >= settings.max_spend_without_order &&
      clicks >= settings.min_clicks_for_decision
    ) {
      return "DISABLE_NO_CONVERSION";
    }
    return "REVIEW";
  }

  /**
   * Hard override applied at preview time regardless of AI output (SPEC §21).
   * Returns {classification, zero_spend_group, downgraded, note}.
   */
  function applySafetyOverride(kw, aiClassification) {
    const spend = kw.spend || 0;
    const clicks = kw.clicks || 0;
    let classification = aiClassification;
    let downgraded = false;
    let note = null;
    let zeroSpendGroup = false;

    if (!isKnownClassification(classification)) {
      classification = "REVIEW";
      downgraded = true;
      note = "Unknown classification — coerced to REVIEW";
    } else if (spend === 0 && classification === "DISABLE_NO_CONVERSION") {
      // Contradiction: cannot have "no conversion" without spend.
      classification = "REVIEW";
      downgraded = true;
      note = "Zero spend contradicts DISABLE_NO_CONVERSION — downgraded to REVIEW";
    } else if (spend === 0 && clicks === 0 && isActionable(classification)) {
      // Allowed, but visually separated, default-unchecked group.
      zeroSpendGroup = true;
    }

    return { classification, zero_spend_group: zeroSpendGroup, downgraded, note };
  }

  return {
    CLASSIFICATIONS,
    isKnownClassification,
    isActionable,
    prelabel,
    applySafetyOverride,
  };
});
