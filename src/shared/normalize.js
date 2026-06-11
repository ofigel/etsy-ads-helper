/**
 * keyword_normalization() — single source of truth for keyword identity.
 * Used by export, import matching, dry run and disable. See SPEC §13.
 *
 * UMD-ish: attaches to globalThis.EAKM in the extension, exports via
 * module.exports under node for tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.normalize = mod;
})(globalThis, function () {
  "use strict";

  const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "’",
    lsquo: "‘",
  };

  /**
   * Decode HTML entities. Uses a textarea in DOM contexts (covers the full
   * named-entity table); falls back to a small map + numeric decoding in
   * non-DOM contexts (unit tests).
   */
  function decodeHtmlEntities(s) {
    if (!/[&]/.test(s)) return s;
    if (typeof document !== "undefined" && document.createElement) {
      const ta = document.createElement("textarea");
      ta.innerHTML = s;
      return ta.value;
    }
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&([a-zA-Z]+);/g, (m, name) =>
        Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
          ? NAMED_ENTITIES[name]
          : m
      );
  }

  /**
   * Canonical keyword normalization. Apostrophes are PRESERVED on purpose:
   * "women's shirt" and "womens shirt" are distinct Etsy keywords.
   */
  function keyword_normalization(raw) {
    let s = String(raw == null ? "" : raw);
    s = decodeHtmlEntities(s);
    s = s.normalize("NFC");
    // zero-width chars, soft hyphen, word joiner
    s = s.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, "");
    // curly / modifier apostrophes → ASCII '
    s = s.replace(/[\u2018\u2019\u02BC]/g, "'");
    s = s.toLowerCase();
    // NBSP explicitly, then collapse all whitespace
    s = s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
    return s;
  }

  /** Build the canonical identity key for a keyword on a listing. */
  function keywordKey(listingId, raw) {
    return String(listingId) + "::" + keyword_normalization(raw);
  }

  /**
   * Extract the first numeric token from arbitrary cell text. Tolerates
   * label prefixes Etsy injects for responsive layouts/screen readers
   * ("Spend $1.42"), currency prefixes ("US$ 1.42") and thousands commas.
   * Returns null when the text contains no number at all.
   */
  function firstNumberIn(text) {
    const s = String(text == null ? "" : text).replace(/,/g, "");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  /** Parse a money cell: "$513.52" / "Spend $513.52" → 513.52, "—"/"" → 0. */
  function parseMoney(text) {
    const n = firstNumberIn(text);
    return n == null ? 0 : n;
  }

  /** Parse a percent cell: "2.8%" → 0.028, "—"/"" → 0. */
  function parsePercent(text) {
    const n = firstNumberIn(text);
    if (n == null) return 0;
    // Avoid float artifacts: 2.8% → 0.028, not 0.027999999999999997
    return Math.round(n * 10000) / 1000000;
  }

  /** Parse a plain number cell: "1,234" → 1234. blankAsNull for ROAS. */
  function parseNumber(text, { blankAsNull = false } = {}) {
    const n = firstNumberIn(text);
    if (n == null) return blankAsNull ? null : 0;
    return n;
  }

  return {
    decodeHtmlEntities,
    keyword_normalization,
    keywordKey,
    firstNumberIn,
    parseMoney,
    parsePercent,
    parseNumber,
  };
});
