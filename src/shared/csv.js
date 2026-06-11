/**
 * CSV serialization for keyword snapshots (RFC 4180 escaping).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.csv = mod;
})(globalThis, function () {
  "use strict";

  function escapeField(value) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows, columns) {
    const header = columns.map((c) => escapeField(c.header)).join(",");
    const lines = rows.map((row) =>
      columns.map((c) => escapeField(c.get(row))).join(",")
    );
    return [header, ...lines].join("\r\n") + "\r\n";
  }

  const KEYWORD_COLUMNS = [
    { header: "keyword", get: (k) => k.keyword_normalized },
    { header: "roas", get: (k) => (k.roas == null ? "" : k.roas) },
    { header: "orders", get: (k) => k.orders },
    { header: "spend", get: (k) => k.spend },
    { header: "revenue", get: (k) => k.revenue },
    { header: "clicks", get: (k) => k.clicks },
    { header: "click_rate", get: (k) => k.click_rate },
    { header: "views", get: (k) => k.views },
    { header: "currently_enabled", get: (k) => k.currently_enabled },
    { header: "prelabel", get: (k) => k.prelabel },
  ];

  /** Serialize snapshot keywords into the canonical CSV used in the ZIP. */
  function keywordsToCsv(keywords) {
    return toCsv(keywords, KEYWORD_COLUMNS);
  }

  return { escapeField, toCsv, keywordsToCsv, KEYWORD_COLUMNS };
});
