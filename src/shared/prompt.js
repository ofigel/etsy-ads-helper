/**
 * AI prompt generation for README.txt / instructions_for_ai. SPEC §15–§16.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.prompt = mod;
})(globalThis, function () {
  "use strict";

  function buildAiPrompt(snapshot, productProfile) {
    const profile = JSON.stringify(productProfile || {}, null, 2);
    return `You are an Etsy Ads keyword auditor. Attached you will find:
1. keywords_data.json — all targeted keywords of one Etsy listing with their stats (also duplicated as keywords.csv for convenience).
2. The product image (product_image.*) if included, or its URL in image_url.txt.

PRODUCT CONTEXT
${profile}

Listing title: ${snapshot.listing_title || "(unknown)"}
Listing ID: ${snapshot.listing_id}
Date range: ${snapshot.date_range_label || "(unknown)"}

YOUR TASK
Look at the product image first: understand the design, the exact theme and, if it is a print-on-demand garment, the blank brand/model if recognizable (e.g. Comfort Colors 1717, Gildan 5000) — buyers searching for a specific blank care about it. Then classify EVERY keyword in keywords_data.json by true relevance to THIS product, not only by click/order statistics. Each keyword already carries an advisory "prelabel" computed from profitability rules — treat it as a hint, not a verdict.

CLASSIFICATIONS (use exactly these strings):
- "KEEP" — relevant and worth targeting.
- "REVIEW" — unclear; a human should look. If you are unsure, ALWAYS use REVIEW.
- "DISABLE_BROAD" — too generic/broad (e.g. "shirt", "gift"), attracts untargeted traffic.
- "DISABLE_IRRELEVANT" — clearly about a different product, theme, audience or occasion.
- "DISABLE_NO_CONVERSION" — relevant-looking but proven money-loser: meaningful spend and clicks, zero orders.

RULES
- Never invent keywords; classify only keywords present in the file.
- If unsure → "REVIEW". Never guess a DISABLE_* class.
- "reason" is optional, max 300 characters.

OUTPUT
Return ONLY a single JSON object (no markdown fences, no commentary), exactly this shape:

{
  "schema_version": 1,
  "listing_id": "${snapshot.listing_id}",
  "results": [
    { "keyword": "<keyword as given>", "classification": "KEEP|REVIEW|DISABLE_BROAD|DISABLE_IRRELEVANT|DISABLE_NO_CONVERSION", "reason": "optional" }
  ]
}

The "results" array must contain one entry per keyword from keywords_data.json.`;
  }

  return { buildAiPrompt };
});
