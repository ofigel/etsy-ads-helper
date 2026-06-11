/**
 * Job engine: export crawl, dry run and disable run, with per-page/per-action
 * checkpointing into chrome.storage.local, resume, abort and throttle
 * handling. SPEC §9, §22–§23, §27–§29.
 *
 * The content script is the only writer of snapshots/jobs/import sessions,
 * so direct chrome.storage.local access here is race-free.
 */
(function (root, factory) {
  const E = root.EAKM || {};
  const mod = factory(
    E.domSelectors,
    E.tableExtractor,
    E.paginator,
    E.toggleDriver,
    E.pageGuards,
    E.normalize,
    E.storageKeys,
    E.classification,
    E.logger
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.jobs = mod;
})(globalThis, function (
  domSelectors,
  tableExtractor,
  paginator,
  toggleDriver,
  pageGuards,
  normalize,
  storageKeys,
  classification,
  logger
) {
  "use strict";

  const KEYS = storageKeys.KEYS;

  // ---- storage helpers ----
  async function sGet(key) {
    const data = await chrome.storage.local.get(key);
    return data[key];
  }
  async function sSet(obj) {
    await chrome.storage.local.set(obj);
  }
  async function getSettings() {
    return storageKeys.sanitizeSettings(await sGet(KEYS.settings));
  }

  // ---- in-memory run state ----
  let activeJob = null; // {job_id, type, abortRequested}
  const listeners = new Set();

  function onProgress(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit(event) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (e) {
        /* listener errors must not kill the job */
      }
    }
  }

  function uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "j-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function isBusy() {
    return Boolean(activeJob);
  }

  function requestAbort() {
    if (activeJob) activeJob.abortRequested = true;
  }

  async function shouldAbort(jobStateKeyGetter) {
    if (activeJob && activeJob.abortRequested) return true;
    // Also honor an abort flag set in storage (e.g. from another surface).
    const stored = jobStateKeyGetter ? await jobStateKeyGetter() : null;
    return Boolean(stored && stored.status === "aborted");
  }

  function newJobState(type, pagesTotal) {
    return {
      job_id: uuid(),
      type,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_page: 1,
      pages_total: pagesTotal || null,
      processed_keys: [],
      status: "running",
      last_error: null,
    };
  }

  function touch(job) {
    job.updated_at = new Date().toISOString();
  }

  // ---- page metadata extraction ----

  function readListingMeta(listingId) {
    const titleHit = domSelectors.resolve("listingTitle");
    const thumbHit = domSelectors.resolve("listingThumb");
    let dateRange = null;
    const drCandidate = [...document.querySelectorAll("button, span")].find((el) =>
      /last \d+ days|this (month|year)|all time/i.test((el.textContent || "").trim()) &&
      (el.textContent || "").length < 80
    );
    if (drCandidate) dateRange = drCandidate.textContent.trim();
    return {
      listing_id: listingId,
      listing_title: titleHit ? titleHit.el.textContent.trim() : null,
      listing_url: location.origin + location.pathname,
      image_url: thumbHit ? thumbHit.el.src : null,
      date_range_label: dateRange,
      totals: readTotalsStrip(),
    };
  }

  /**
   * Stats strip parsing ("Views 41.7K | Clicks 630 | ... | ROAS 1.34").
   * Best-effort: returns nulls when the strip cannot be identified.
   */
  function readTotalsStrip() {
    const labels = ["views", "clicks", "orders", "revenue", "spend", "roas"];
    const out = { views: null, clicks: null, orders: null, revenue: null, spend: null, roas: null };
    const els = [...document.querySelectorAll("span,div,p,dt,h3")].filter(
      (el) => el.childElementCount === 0
    );
    for (const label of labels) {
      const labelEl = els.find((el) => (el.textContent || "").trim().toLowerCase() === label);
      if (!labelEl) continue;
      let scope = labelEl.parentElement;
      for (let up = 0; up < 3 && scope; up++) {
        const txt = (scope.textContent || "").replace(labelEl.textContent, "").trim();
        const m = txt.match(/\$?[\d,.]+\s*[kKmM]?/);
        if (m) {
          out[label] = parseHumanNumber(m[0]);
          break;
        }
        scope = scope.parentElement;
      }
    }
    return out;
  }

  function parseHumanNumber(text) {
    const s = String(text).trim().replace(/[$,]/g, "");
    const m = s.match(/^([\d.]+)\s*([kKmM])?$/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    if (m[2]) n *= /k/i.test(m[2]) ? 1e3 : 1e6;
    return n;
  }

  /** Click "Expand data" if the keywords section is collapsed. */
  async function ensureDataExpanded(settings) {
    const btn = [...document.querySelectorAll("button, a")].find((b) =>
      /expand data/i.test((b.textContent || "").trim())
    );
    if (btn && !domSelectors.isDisabledControl(btn)) {
      paginator.userLikeClick(btn);
      await paginator.sleep(600);
    }
  }

  // ---- export ----

  /**
   * Run (or resume) the export crawl. opts: {resume:boolean}.
   * Progress events: {type:"export", phase, page, pagesTotal, collected}.
   */
  async function runExport(listingId, opts = {}) {
    if (isBusy()) throw new Error("Another job is already running");
    const settings = await getSettings();
    const snapKey = KEYS.snapshot(listingId);
    let snapshot = opts.resume ? await sGet(snapKey) : null;
    const resuming = Boolean(opts.resume && snapshot && snapshot.job && snapshot.job.status !== "done");

    activeJob = { type: "export", abortRequested: false };
    try {
      await ensureDataExpanded(settings);
      await paginator.waitForTable(settings.table_wait_timeout_ms);
      let table = paginator.currentTable();
      const { colMap, warnings } = tableExtractor.mapColumns(table);
      for (const w of warnings) {
        await logger.log({ listing_id: listingId, level: "warn", event: "EXPORT_STARTED", detail: { warning: w } }, settings.log_max_entries);
      }

      const meta = readListingMeta(listingId);
      const expected = domSelectors.findExpectedKeywordCount();
      const pagination = domSelectors.findPagination(table);
      const pagesTotal = domSelectors.readPagesTotal(pagination) || 1;

      if (!resuming) {
        // Keep the previous snapshot around (SPEC §14).
        const prev = await sGet(snapKey);
        if (prev) await sSet({ [KEYS.snapshotPrev(listingId)]: prev });
        snapshot = {
          schema_version: storageKeys.SCHEMA_VERSION,
          listing_id: String(listingId),
          listing_title: meta.listing_title,
          listing_url: meta.listing_url,
          image_url: meta.image_url,
          exported_at: null,
          date_range_label: meta.date_range_label,
          totals: meta.totals,
          expected_keyword_count: expected,
          filter_spend_gt_zero: settings.only_spend_gt_zero,
          stopped_early_at_page: null,
          pages_total: pagesTotal,
          pages_crawled: 0,
          complete: false,
          collisions: 0,
          keywords: [],
          job: newJobState("export", pagesTotal),
        };
      } else {
        snapshot.job.status = "running";
        snapshot.job.last_error = null;
        touch(snapshot.job);
      }
      await sSet({ [snapKey]: snapshot });
      await logger.log(
        {
          job_id: snapshot.job.job_id,
          listing_id: listingId,
          event: resuming ? "JOB_RESUMED" : "EXPORT_STARTED",
          detail: { pages_total: pagesTotal, expected, filter_spend_gt_zero: settings.only_spend_gt_zero },
        },
        settings.log_max_entries
      );

      // Sort by Spend descending when collecting only spend > 0 keywords so
      // the early-stop rule below is sound.
      if (settings.only_spend_gt_zero) {
        table = await paginator.sortBySpendDesc(colMap, settings.pagination_settle_timeout_ms);
      }
      table = await paginator.gotoFirstPage(settings.pagination_settle_timeout_ms);

      // Fast-forward when resuming.
      let page = 1;
      if (resuming && snapshot.job.current_page > 1) {
        for (; page < snapshot.job.current_page; ) {
          const res = await paginator.nextPage(settings.pagination_settle_timeout_ms);
          table = res.table;
          if (!res.advanced) break;
          page++;
          await paginator.sleepJittered(Math.max(500, settings.page_delay_ms / 2));
        }
      }

      const acc = new Map((snapshot.keywords || []).map((k) => [k.key, k]));
      let consecutiveFailures = 0;
      let stoppedEarly = false;

      for (;;) {
        if (await shouldAbort(() => sGet(snapKey).then((s) => s && s.job))) {
          snapshot.job.status = "aborted";
          touch(snapshot.job);
          await sSet({ [snapKey]: snapshot });
          await logger.log({ job_id: snapshot.job.job_id, listing_id: listingId, event: "JOB_ABORTED", page }, settings.log_max_entries);
          emit({ type: "export", phase: "aborted", page, pagesTotal, collected: acc.size });
          return snapshot;
        }

        table = paginator.currentTable();
        let records;
        try {
          records = tableExtractor.extractRows(table, colMap, listingId, page);
          consecutiveFailures = 0;
        } catch (e) {
          consecutiveFailures++;
          throw e;
        }

        let pageRecords = records;
        if (settings.only_spend_gt_zero) {
          pageRecords = records.filter((r) => r.spend > 0);
          if (pageRecords.length === 0 && records.length > 0) {
            // Sorted desc by spend: first all-zero page means we're done.
            stoppedEarly = true;
            snapshot.stopped_early_at_page = page;
          }
        }
        snapshot.collisions += tableExtractor.mergeRecords(acc, pageRecords);
        snapshot.keywords = [...acc.values()];
        snapshot.pages_crawled = Math.max(snapshot.pages_crawled, page);
        snapshot.job.current_page = page;
        touch(snapshot.job);
        await sSet({ [snapKey]: snapshot }); // checkpoint BEFORE navigating (SPEC §22)
        await logger.log(
          { job_id: snapshot.job.job_id, listing_id: listingId, event: "EXPORT_PAGE_DONE", page, detail: { collected: acc.size } },
          settings.log_max_entries
        );
        emit({ type: "export", phase: "page", page, pagesTotal, collected: acc.size });

        const throttle = pageGuards.checkThrottle(document, consecutiveFailures);
        if (throttle.throttled) {
          snapshot.job.status = "paused";
          snapshot.job.last_error = "THROTTLE_DETECTED";
          touch(snapshot.job);
          await sSet({ [snapKey]: snapshot });
          await logger.log({ job_id: snapshot.job.job_id, listing_id: listingId, level: "error", event: "THROTTLE_DETECTED", page, detail: { reason: throttle.reason } }, settings.log_max_entries);
          emit({ type: "export", phase: "throttled", page, pagesTotal, collected: acc.size });
          return snapshot;
        }

        if (stoppedEarly || page >= pagesTotal) break;

        await paginator.sleepJittered(settings.page_delay_ms);
        let advanced;
        try {
          const res = await paginator.nextPage(settings.pagination_settle_timeout_ms);
          table = res.table;
          advanced = res.advanced;
          consecutiveFailures = 0;
        } catch (e) {
          consecutiveFailures++;
          if (consecutiveFailures >= 3) throw e;
          await paginator.sleep(Math.min(30000, settings.page_delay_ms * Math.pow(2, consecutiveFailures)));
          continue; // retry same page
        }
        if (!advanced) break;
        page++;
      }

      // Finalize: prelabels + complete flag.
      for (const kw of snapshot.keywords) {
        kw.prelabel = classification.prelabel(kw, settings);
      }
      snapshot.exported_at = new Date().toISOString();
      snapshot.complete = true;
      snapshot.job.status = "done";
      touch(snapshot.job);
      await sSet({ [snapKey]: snapshot });
      await logger.log(
        {
          job_id: snapshot.job.job_id,
          listing_id: listingId,
          event: "EXPORT_DONE",
          detail: { keywords: snapshot.keywords.length, pages: snapshot.pages_crawled, stopped_early: stoppedEarly, collisions: snapshot.collisions },
        },
        settings.log_max_entries
      );
      emit({ type: "export", phase: "done", page, pagesTotal, collected: snapshot.keywords.length });
      return snapshot;
    } catch (e) {
      const settings2 = await getSettings();
      const snap = (await sGet(snapKey)) || snapshot;
      if (snap && snap.job) {
        snap.job.status = "failed";
        snap.job.last_error = e.code || e.message;
        touch(snap.job);
        await sSet({ [snapKey]: snap });
      }
      await logger.log(
        { listing_id: listingId, level: "error", event: e.code || "EXPORT_FAILED", detail: { message: e.message } },
        settings2.log_max_entries
      );
      emit({ type: "export", phase: "error", error: e.code || e.message });
      throw e;
    } finally {
      activeJob = null;
    }
  }

  // ---- crawl helper shared by dry run / disable ----

  /**
   * Walk pages from page 1, calling handlePage(table, colMap, page) per page.
   * Stops when handlePage returns "stop", when pages are exhausted, on abort
   * (returns "aborted") or throttle (returns "throttled").
   */
  async function walkPages(listingId, settings, jobStateGetter, handlePage, perPageDelayMs) {
    await ensureDataExpanded(settings);
    await paginator.waitForTable(settings.table_wait_timeout_ms);
    let table = await paginator.gotoFirstPage(settings.pagination_settle_timeout_ms);
    const { colMap } = tableExtractor.mapColumns(table);
    const pagination = domSelectors.findPagination(table);
    const pagesTotal = domSelectors.readPagesTotal(pagination) || 1;
    let consecutiveFailures = 0;

    for (let page = 1; ; page++) {
      if (await shouldAbort(jobStateGetter)) return { outcome: "aborted", page, pagesTotal };
      table = paginator.currentTable();
      const verdict = await handlePage(table, colMap, page, pagesTotal);
      const throttle = pageGuards.checkThrottle(document, consecutiveFailures);
      if (throttle.throttled) return { outcome: "throttled", page, pagesTotal, reason: throttle.reason };
      if (verdict === "stop" || page >= pagesTotal) return { outcome: "done", page, pagesTotal };

      await paginator.sleepJittered(perPageDelayMs);
      try {
        const res = await paginator.nextPage(settings.pagination_settle_timeout_ms);
        if (!res.advanced) return { outcome: "done", page, pagesTotal };
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) return { outcome: "throttled", page, pagesTotal, reason: "consecutive-failures" };
        await paginator.sleep(Math.min(30000, settings.page_delay_ms * Math.pow(2, consecutiveFailures)));
        page--; // retry same page
      }
    }
  }

  // ---- dry run ----

  /**
   * Read-only verification crawl over the selected keyword set (SPEC §27).
   * Returns {found[], not_found[], already_disabled[], state_unreadable[]}.
   */
  async function runDryRun(listingId, selectedNorms) {
    if (isBusy()) throw new Error("Another job is already running");
    const settings = await getSettings();
    const importKey = KEYS.importSession(listingId);
    activeJob = { type: "dry_run", abortRequested: false };

    const remaining = new Set(selectedNorms);
    const report = { found: [], not_found: [], already_disabled: [], state_unreadable: [] };
    const session = await sGet(importKey);
    if (!session) throw new Error("No import session");
    session.job = newJobState("dry_run", null);
    await sSet({ [importKey]: session });
    await logger.log({ job_id: session.job.job_id, listing_id: listingId, event: "DRYRUN_STARTED", detail: { selected: selectedNorms.length } }, settings.log_max_entries);

    try {
      const res = await walkPages(
        listingId,
        settings,
        () => sGet(importKey).then((s) => s && s.job),
        async (table, colMap, page, pagesTotal) => {
          const rows = tableExtractor.extractRows(table, colMap, listingId, page);
          for (const rec of rows) {
            if (!remaining.has(rec.keyword_normalized)) continue;
            remaining.delete(rec.keyword_normalized);
            if (!rec.toggle_state_readable) report.state_unreadable.push(rec.keyword_normalized);
            else if (rec.currently_enabled === false) report.already_disabled.push(rec.keyword_normalized);
            else report.found.push(rec.keyword_normalized);
          }
          emit({ type: "dry_run", phase: "page", page, pagesTotal, remaining: remaining.size });
          session.job.current_page = page;
          session.job.pages_total = pagesTotal;
          touch(session.job);
          await sSet({ [importKey]: session });
          return remaining.size === 0 ? "stop" : "continue";
        },
        Math.max(1000, settings.page_delay_ms / 2) // read-only: lighter delay floor
      );

      report.not_found = [...remaining];
      const outcomeOk = res.outcome === "done";
      session.job.status = outcomeOk ? "done" : res.outcome;
      session.dry_run_report = report;
      session.dry_run_at = new Date().toISOString();
      session.dry_run_ok = outcomeOk;
      if (outcomeOk) session.gate = "dry_run_ok";
      touch(session.job);
      await sSet({ [importKey]: session });
      await logger.log(
        { job_id: session.job.job_id, listing_id: listingId, event: "DRYRUN_DONE", detail: { found: report.found.length, not_found: report.not_found.length, already_disabled: report.already_disabled.length, unreadable: report.state_unreadable.length, outcome: res.outcome } },
        settings.log_max_entries
      );
      emit({ type: "dry_run", phase: outcomeOk ? "done" : res.outcome, report });
      return { report, outcome: res.outcome };
    } catch (e) {
      session.job.status = "failed";
      session.job.last_error = e.code || e.message;
      await sSet({ [importKey]: session });
      await logger.log({ listing_id: listingId, level: "error", event: e.code || "DRYRUN_FAILED", detail: { message: e.message } }, settings.log_max_entries);
      emit({ type: "dry_run", phase: "error", error: e.code || e.message });
      throw e;
    } finally {
      activeJob = null;
    }
  }

  // ---- disable run ----

  /**
   * Real disable run (SPEC §28). Preconditions (gate, selection hash,
   * confirmation) are enforced by the caller (panel) before invoking.
   */
  async function runDisable(listingId, runSetNorms) {
    if (isBusy()) throw new Error("Another job is already running");
    const settings = await getSettings();
    const importKey = KEYS.importSession(listingId);
    activeJob = { type: "disable", abortRequested: false };

    const session = await sGet(importKey);
    if (!session) throw new Error("No import session");
    const processed = new Set(session.job && session.job.type === "disable" ? session.job.processed_keys : []);
    const target = new Set(runSetNorms.filter((k) => !processed.has(k)));
    if (!(session.job && session.job.type === "disable" && session.job.status === "paused")) {
      session.job = newJobState("disable", null);
    } else {
      session.job.status = "running";
    }
    session.gate = "executing";
    await sSet({ [importKey]: session });
    await logger.log({ job_id: session.job.job_id, listing_id: listingId, event: "DISABLE_STARTED", detail: { total: runSetNorms.length, remaining: target.size } }, settings.log_max_entries);

    const report = { disabled_ok: [], skipped_already: [], failed: [], unreadable: [] };
    let backoffMs = 0;

    try {
      const res = await walkPages(
        listingId,
        settings,
        () => sGet(importKey).then((s) => s && s.job),
        async (table, colMap, page, pagesTotal) => {
          const rows = tableExtractor.extractRows(table, colMap, listingId, page);
          for (const rec of rows) {
            const norm = rec.keyword_normalized;
            if (!target.has(norm)) continue;
            if (await shouldAbort(() => sGet(importKey).then((s) => s && s.job))) return "stop";

            const live = toggleDriver.findKeywordRow(paginator.currentTable() || table, colMap, norm);
            const state = live ? live.state : null;
            if (state === null) {
              report.unreadable.push(norm);
              target.delete(norm);
              await logger.log({ job_id: session.job.job_id, listing_id: listingId, level: "warn", event: "TOGGLE_STATE_UNREADABLE", keyword: norm, page }, settings.log_max_entries);
              continue; // never click blind
            }
            if (state === false) {
              report.skipped_already.push(norm);
              target.delete(norm);
              processed.add(norm);
              await logger.log({ job_id: session.job.job_id, listing_id: listingId, event: "SKIP_ALREADY_DISABLED", keyword: norm, page }, settings.log_max_entries);
            } else {
              const result = await toggleDriver.clickAndVerify(table, colMap, norm, false, settings.toggle_verify_timeout_ms);
              if (result.ok) {
                report.disabled_ok.push(norm);
                target.delete(norm);
                processed.add(norm);
                backoffMs = 0;
                await logger.log({ job_id: session.job.job_id, listing_id: listingId, event: "DISABLED_OK", keyword: norm, page, detail: { retried: result.retried } }, settings.log_max_entries);
                await appendDisabledRegistry(listingId, norm);
              } else {
                report.failed.push(norm);
                target.delete(norm);
                backoffMs = Math.min(30000, (backoffMs || settings.click_delay_ms) * 2);
                await logger.log({ job_id: session.job.job_id, listing_id: listingId, level: "error", event: "TOGGLE_FAILED", keyword: norm, page, detail: { error: result.error, retried: result.retried } }, settings.log_max_entries);
              }
            }

            // Checkpoint after every keyword action.
            session.job.processed_keys = [...processed];
            session.job.current_page = page;
            session.job.pages_total = pagesTotal;
            touch(session.job);
            await sSet({ [importKey]: session });
            emit({ type: "disable", phase: "keyword", page, pagesTotal, done: processed.size, total: runSetNorms.length, report });

            await paginator.sleepJittered(settings.click_delay_ms + backoffMs);
          }
          return target.size === 0 ? "stop" : "continue";
        },
        settings.page_delay_ms
      );

      report.not_found = [...target];
      for (const norm of report.not_found) {
        await logger.log({ job_id: session.job.job_id, listing_id: listingId, level: "warn", event: "KEYWORD_NOT_FOUND", keyword: norm }, settings.log_max_entries);
      }
      const finished = res.outcome === "done";
      session.job.status = finished ? "done" : res.outcome === "throttled" ? "paused" : res.outcome;
      if (res.outcome === "throttled") session.job.last_error = "THROTTLE_DETECTED";
      session.gate = finished ? "done" : session.gate;
      session.disable_report = report;
      touch(session.job);
      await sSet({ [importKey]: session });
      await logger.log(
        { job_id: session.job.job_id, listing_id: listingId, event: finished ? "DISABLE_DONE" : "JOB_PAUSED", detail: { ok: report.disabled_ok.length, skipped: report.skipped_already.length, failed: report.failed.length, unreadable: report.unreadable.length, outcome: res.outcome } },
        settings.log_max_entries
      );
      emit({ type: "disable", phase: finished ? "done" : res.outcome, report });
      return { report, outcome: res.outcome };
    } catch (e) {
      session.job.status = "failed";
      session.job.last_error = e.code || e.message;
      await sSet({ [importKey]: session });
      await logger.log({ listing_id: listingId, level: "error", event: e.code || "DISABLE_FAILED", detail: { message: e.message } }, settings.log_max_entries);
      emit({ type: "disable", phase: "error", error: e.code || e.message });
      throw e;
    } finally {
      activeJob = null;
    }
  }

  /** Rollback support data (SPEC §32) — schema only in v1. */
  async function appendDisabledRegistry(listingId, keywordNormalized) {
    const key = KEYS.disabledRegistry(listingId);
    const list = (await sGet(key)) || [];
    list.push({
      keyword_normalized: keywordNormalized,
      listing_id: String(listingId),
      previous_state: "enabled",
      disabled_at: new Date().toISOString(),
    });
    await sSet({ [key]: list });
  }

  /**
   * On injection: mark stale running jobs as paused so the panel can offer
   * Resume (SPEC §23).
   */
  async function recoverStaleJobs(listingId) {
    const out = { export: null, import: null };
    const snapKey = KEYS.snapshot(listingId);
    const importKey = KEYS.importSession(listingId);
    const STALE_MS = 30000;
    const now = Date.now();

    const snap = await sGet(snapKey);
    if (snap && snap.job && snap.job.status === "running" && now - Date.parse(snap.job.updated_at) > STALE_MS) {
      snap.job.status = "paused";
      snap.job.last_error = "JOB_INTERRUPTED";
      await sSet({ [snapKey]: snap });
      await logger.log({ job_id: snap.job.job_id, listing_id: listingId, level: "warn", event: "JOB_PAUSED", detail: { reason: "stale-on-injection" } });
      out.export = snap.job;
    }
    const session = await sGet(importKey);
    if (session && session.job && session.job.status === "running" && now - Date.parse(session.job.updated_at) > STALE_MS) {
      session.job.status = "paused";
      session.job.last_error = "JOB_INTERRUPTED";
      await sSet({ [importKey]: session });
      await logger.log({ job_id: session.job.job_id, listing_id: listingId, level: "warn", event: "JOB_PAUSED", detail: { reason: "stale-on-injection" } });
      out.import = session.job;
    }
    return out;
  }

  return {
    onProgress,
    isBusy,
    requestAbort,
    runExport,
    runDryRun,
    runDisable,
    recoverStaleJobs,
    readListingMeta,
    parseHumanNumber,
  };
});
