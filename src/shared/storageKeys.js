/**
 * chrome.storage.local key constants, versioning and default settings.
 * SPEC §14, §33.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.storageKeys = mod;
})(globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const TOOL_ID = "etsy-ads-keyword-manager/0.1.7";
  const STALE_EXPORT_DAYS = 7;

  const KEYS = {
    settings: "settings",
    oplog: "oplog",
    panelState: "panel_state",
    snapshot: (listingId) => `snapshot:${listingId}`,
    snapshotPrev: (listingId) => `snapshot_prev:${listingId}`,
    importSession: (listingId) => `import:${listingId}`,
    productProfile: (listingId) => `product_profile:${listingId}`,
    disabledRegistry: (listingId) => `disabled_registry:${listingId}`,
  };

  const DEFAULT_SETTINGS = {
    schema_version: SCHEMA_VERSION,
    target_min_roas: 2.0,
    break_even_roas: 1.25,
    max_spend_without_order: 5.0,
    min_clicks_for_decision: 8,
    click_delay_ms: 1200,
    page_delay_ms: 2500,
    toggle_verify_timeout_ms: 5000,
    pagination_settle_timeout_ms: 10000,
    table_wait_timeout_ms: 20000,
    stale_export_days: STALE_EXPORT_DAYS,
    log_max_entries: 2000,
    // Export scope: when true, sort by Spend desc first and stop crawling at
    // the first page where every row has spend == 0.
    only_spend_gt_zero: true,
  };

  // Hard floors/ceilings for settings validation (SPEC §33).
  const SETTINGS_LIMITS = {
    target_min_roas: { min: 0, max: 100 },
    break_even_roas: { min: 0, max: 100 },
    max_spend_without_order: { min: 0, max: 10000 },
    min_clicks_for_decision: { min: 0, max: 1000 },
    click_delay_ms: { min: 500, max: 60000 },
    page_delay_ms: { min: 1000, max: 120000 },
    toggle_verify_timeout_ms: { min: 1000, max: 60000 },
    pagination_settle_timeout_ms: { min: 2000, max: 120000 },
    table_wait_timeout_ms: { min: 5000, max: 120000 },
    stale_export_days: { min: 1, max: 365 },
    log_max_entries: { min: 100, max: 20000 },
  };

  /** Merge stored settings over defaults and clamp to limits. */
  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    for (const [field, lim] of Object.entries(SETTINGS_LIMITS)) {
      const v = Number(s[field]);
      if (!Number.isFinite(v)) s[field] = DEFAULT_SETTINGS[field];
      else s[field] = Math.min(lim.max, Math.max(lim.min, v));
    }
    s.only_spend_gt_zero = Boolean(s.only_spend_gt_zero);
    s.schema_version = SCHEMA_VERSION;
    return s;
  }

  return {
    SCHEMA_VERSION,
    TOOL_ID,
    STALE_EXPORT_DAYS,
    KEYS,
    DEFAULT_SETTINGS,
    SETTINGS_LIMITS,
    sanitizeSettings,
  };
});
