/**
 * Operation log: newest-first ring buffer in chrome.storage.local. SPEC §31.
 * Append is serialized through a promise chain to avoid read-modify-write
 * races within the content script (the only writer).
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.storageKeys) ||
      (typeof require === "function" ? require("./storageKeys.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.logger = mod;
})(globalThis, function (storageKeys) {
  "use strict";

  let chain = Promise.resolve();

  function storageArea() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  /**
   * Append one entry. entry: {job_id, listing_id, level, event, keyword, page, detail}
   * ts is stamped here.
   */
  function log(entry, maxEntries) {
    const area = storageArea();
    const full = Object.assign(
      {
        ts: new Date().toISOString(),
        job_id: null,
        listing_id: null,
        level: "info",
        event: "LOG",
        keyword: null,
        page: null,
        detail: {},
      },
      entry
    );
    if (!area) {
      // Test/node context: just echo.
      return Promise.resolve(full);
    }
    chain = chain.then(async () => {
      const key = storageKeys.KEYS.oplog;
      const data = await area.get(key);
      const list = Array.isArray(data[key]) ? data[key] : [];
      list.unshift(full);
      const cap = maxEntries || storageKeys.DEFAULT_SETTINGS.log_max_entries;
      if (list.length > cap) list.length = cap;
      await area.set({ [key]: list });
      return full;
    });
    return chain;
  }

  async function readAll() {
    const area = storageArea();
    if (!area) return [];
    const key = storageKeys.KEYS.oplog;
    const data = await area.get(key);
    return Array.isArray(data[key]) ? data[key] : [];
  }

  async function clear() {
    const area = storageArea();
    if (!area) return;
    await area.set({ [storageKeys.KEYS.oplog]: [] });
  }

  return { log, readAll, clear };
});
