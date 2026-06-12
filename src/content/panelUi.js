/**
 * Floating on-page panel (Shadow DOM, bottom-right, collapsible) — the whole
 * UI of the extension. Rendered only on supported Etsy Ads listing-stats
 * pages. Tabs: Export / Import / Preview / Run / Log / Settings.
 */
(function (root, factory) {
  const E = root.EAKM || {};
  const mod = factory(E);
  root.EAKM = root.EAKM || {};
  root.EAKM.panelUi = mod;
})(globalThis, function (E) {
  "use strict";

  const KEYS = E.storageKeys.KEYS;
  const TABS = ["Export", "Import", "Preview", "Run", "Log", "Settings"];

  // Cat-biting-hand icon (Etsy icon set), rendered in brand orange.
  const ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M20.5 3A.5.5 0 0 1 21 3.5V20.5A.5.5 0 0 1 20.5 21H19.268A.5.5 0 0 1 18.852 20.777 3.3 3.3 0 0 0 17.007 19.431L11.772 17.935 10.963 20.775A1 1 0 0 1 9.758 21.47L5.758 20.47A1 1 0 0 1 5 19.5V8.377A.5.5 0 0 1 5.362 7.897L17.008 4.567A3.3 3.3 0 0 0 18.852 3.223.5.5 0 0 1 19.268 3zM7 18.72 9.304 19.295 9.849 17.385 7 16.57z"></path>' +
    '<path d="M3 8A.5.5 0 0 1 3.5 8.5V15.5A.5.5 0 0 1 3 16H1.5A.5.5 0 0 1 1 15.5V8.5A.5.5 0 0 1 1.5 8z"></path></svg>';

  function iconEl(size) {
    const span = document.createElement("span");
    span.className = "brandicon";
    span.style.width = size + "px";
    span.style.height = size + "px";
    span.innerHTML = ICON_SVG;
    return span;
  }

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.wrap { position: fixed; bottom: 18px; right: 18px; z-index: 2147483600; }
.brandicon { display: inline-flex; color: #f1641e; }
.brandicon svg { width: 100%; height: 100%; }
.bubble { width: 48px; height: 48px; border-radius: 50%; background: #fff; border: 2px solid #f1641e;
  cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); display:flex; align-items:center; justify-content:center; padding: 0; }
.panel { width: 360px; max-height: 560px; background: #fff; border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.22); border: 1px solid #e5e5e5; display: flex; flex-direction: column; overflow: hidden; }
.hdr { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #eee; }
.hdr .title { font-weight: 600; font-size: 14px; color: #222; flex: 1; }
.hdr button { background: none; border: none; cursor: pointer; font-size: 15px; color: #888; padding: 2px 6px; }
.hdr button:hover { color: #222; }
.tabs { display: flex; border-bottom: 1px solid #eee; }
.tabs button { flex: 1; background: none; border: none; padding: 8px 0; font-size: 12px; color: #777; cursor: pointer;
  border-bottom: 2px solid transparent; }
.tabs button.active { color: #f1641e; border-bottom-color: #f1641e; font-weight: 600; }
.body { padding: 12px; overflow-y: auto; font-size: 13px; color: #333; }
.row { margin-bottom: 10px; }
.muted { color: #888; font-size: 12px; }
.btn { display: inline-block; background: #f1641e; color: #fff; border: none; border-radius: 8px; padding: 9px 14px;
  font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; text-align: center; }
.btn:disabled { background: #f3b08c; cursor: not-allowed; }
.btn.secondary { background: #fff; color: #f1641e; border: 1px solid #f1641e; }
.btn.danger { background: #c0392b; }
.btn + .btn { margin-top: 8px; }
.warn { background: #fff7e0; border: 1px solid #f0d48a; color: #7a5b00; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; }
.error { background: #fdecea; border: 1px solid #f5c6c0; color: #92271c; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; white-space: pre-wrap; }
.ok { background: #eaf7ee; border: 1px solid #b9e2c4; color: #1d6b35; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; }
.chk { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 6px; }
.chk input { margin-top: 2px; }
.progress { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin: 6px 0; }
.progress > div { height: 100%; background: #f1641e; transition: width .3s; }
.group { border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; }
.group > summary { padding: 8px 10px; cursor: pointer; font-weight: 600; font-size: 12px; }
.group .rows { padding: 4px 10px 8px; max-height: 180px; overflow-y: auto; }
.kwrow { display: flex; gap: 6px; align-items: baseline; padding: 3px 0; border-top: 1px solid #f5f5f5; font-size: 12px; }
.kwrow .kw { flex: 1; word-break: break-word; }
.kwrow .stat { color: #999; white-space: nowrap; }
.kwrow.locked { opacity: .5; }
.badge { background: #eee; color: #666; border-radius: 6px; padding: 0 5px; font-size: 10px; }
input[type=number], input[type=text], textarea, input[type=file] { width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; }
textarea { resize: vertical; min-height: 48px; }
label.field { display: block; margin-bottom: 8px; font-size: 12px; color: #555; }
.logent { border-top: 1px solid #f3f3f3; padding: 4px 0; font-size: 11px; }
.logent .ev { font-weight: 600; }
.logent.warn .ev { color: #9c6f00; }
.logent.error .ev { color: #b03022; }
.flex { display: flex; gap: 8px; }
.flex .btn { flex: 1; }
`;

  // ---- tiny DOM helper ----
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "onclick" || k === "onchange" || k === "oninput") el[k] = v;
        else if (k === "checked") el.checked = Boolean(v);
        else if (k === "disabled") el.disabled = Boolean(v);
        else if (k === "value") el.value = v;
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function sGet(key) {
    const data = await chrome.storage.local.get(key);
    return data[key];
  }
  async function sSet(obj) {
    await chrome.storage.local.set(obj);
  }

  function selectionHash(norms) {
    const s = [...norms].sort().join("\n");
    let hsh = 5381;
    for (let i = 0; i < s.length; i++) hsh = ((hsh << 5) + hsh + s.charCodeAt(i)) >>> 0;
    return "h" + hsh.toString(16) + ":" + norms.length;
  }

  // SORT_FAILED is deliberately absent: a failed sort falls back to a full
  // crawl and must not raise the "update the extension" banner.
  const DOM_DRIFT_CODES = new Set(["TABLE_NOT_FOUND", "COLUMN_MAPPING_FAILED", "PAGINATION_FAILED"]);

  // ---- panel state ----
  let host = null;
  let shadow = null;
  let state = {
    listingId: null,
    tab: "Export",
    collapsed: false,
    progress: null, // {label, pct}
    flash: null, // {kind:"ok"|"warn"|"error", text}
    domDrift: false,
  };

  function setFlash(kind, text) {
    state.flash = { kind, text };
    render();
  }

  function flagDomDriftIfNeeded(errLike) {
    const code = (errLike && (errLike.code || errLike.message || errLike)) + "";
    if ([...DOM_DRIFT_CODES].some((c) => code.includes(c))) {
      state.domDrift = true;
    }
  }

  // ---- mount / unmount ----
  async function mount(listingId) {
    if (host) unmount();
    state.listingId = listingId;
    const saved = (await sGet(KEYS.panelState)) || {};
    state.collapsed = Boolean(saved.collapsed);
    state.tab = TABS.includes(saved.tab) ? saved.tab : "Export";

    host = document.createElement("div");
    host.id = "eakm-panel-host";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.append(style, h("div", { class: "wrap" }));
    document.documentElement.append(host);

    E.jobs.onProgress(onJobProgress);
    render();
  }

  function unmount() {
    if (host) host.remove();
    host = null;
    shadow = null;
  }

  function toggleCollapsed() {
    state.collapsed = !state.collapsed;
    sSet({ [KEYS.panelState]: { collapsed: state.collapsed, tab: state.tab } });
    render();
  }

  function switchTab(tab) {
    state.tab = tab;
    state.flash = null;
    sSet({ [KEYS.panelState]: { collapsed: state.collapsed, tab } });
    if (tab === "Preview") markPreviewed();
    render();
  }

  function onJobProgress(ev) {
    if (ev.phase === "page") {
      const pct = ev.pagesTotal ? Math.round((ev.page / ev.pagesTotal) * 100) : 0;
      state.progress = { label: `Page ${ev.page} of ${ev.pagesTotal || "?"} — ${ev.collected != null ? ev.collected + " keywords" : "scanning"}`, pct };
    } else if (ev.phase === "keyword") {
      const pct = ev.total ? Math.round((ev.done / ev.total) * 100) : 0;
      state.progress = { label: `Disabling ${ev.done} of ${ev.total} (page ${ev.page})`, pct };
    } else if (ev.phase === "notice") {
      state.flash = { kind: "warn", text: ev.message };
    } else if (ev.phase === "done") {
      state.progress = null;
      if (ev.type === "export" && ev.collected === 0) {
        state.flash = {
          kind: "warn",
          text:
            "Export finished, but 0 keywords were collected. The Spend column may not be parsing on this page markup — press “Copy diagnostics” below and share it with the developer.",
        };
      } else {
        state.flash = { kind: "ok", text: "Job finished." };
      }
    } else if (ev.phase === "throttled") {
      state.progress = null;
      state.flash = { kind: "error", text: "Etsy may be rate-limiting. Wait a few minutes, then Resume." };
    } else if (ev.phase === "aborted") {
      state.progress = null;
      state.flash = { kind: "warn", text: "Job aborted. Progress up to the last checkpoint is saved." };
    } else if (ev.phase === "error") {
      state.progress = null;
      flagDomDriftIfNeeded(ev.error);
      state.flash = { kind: "error", text: "Job failed: " + ev.error };
    }
    render();
  }

  // ---- async render ----
  let renderSeq = 0;
  async function render() {
    if (!shadow) return;
    const seq = ++renderSeq;
    const wrap = shadow.querySelector(".wrap");
    if (!wrap) return;

    if (state.collapsed) {
      const bubble = h("button", { class: "bubble", title: "Etsy Ads Keyword Manager", onclick: toggleCollapsed });
      bubble.append(iconEl(26));
      wrap.replaceChildren(bubble);
      return;
    }

    const bodyEl = h("div", { class: "body" }, h("div", { class: "muted" }, "Loading…"));
    const panel = h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "hdr" },
        iconEl(20),
        h("div", { class: "title" }, "Ads Keyword Manager"),
        h("button", { title: "Collapse", onclick: toggleCollapsed }, "—")
      ),
      h(
        "div",
        { class: "tabs" },
        TABS.map((t) =>
          h("button", { class: t === state.tab ? "active" : "", onclick: () => switchTab(t) }, t)
        )
      ),
      bodyEl
    );
    wrap.replaceChildren(panel);

    const content = await renderTab(state.tab).catch((e) =>
      h("div", { class: "error" }, "Panel error: " + (e.message || e))
    );
    if (seq !== renderSeq || !shadow) return; // stale render
    const parts = [];
    if (state.domDrift) {
      parts.push(
        h(
          "div",
          { class: "warn" },
          "Etsy's page structure seems to have changed and the extension could not read it. Please update the extension to the latest version."
        )
      );
    }
    if (state.flash) parts.push(h("div", { class: state.flash.kind }, state.flash.text));
    if (state.progress) {
      parts.push(
        h("div", { class: "row" }, h("div", { class: "muted" }, state.progress.label), h("div", { class: "progress" }, h("div", { style: `width:${state.progress.pct}%` })))
      );
      if (E.jobs.isBusy()) {
        parts.push(h("button", { class: "btn danger", onclick: () => E.jobs.requestAbort() }, "Abort job"));
      }
    }
    parts.push(content);
    bodyEl.replaceChildren(...parts);
  }

  async function renderTab(tab) {
    switch (tab) {
      case "Export":
        return renderExport();
      case "Import":
        return renderImport();
      case "Preview":
        return renderPreview();
      case "Run":
        return renderRun();
      case "Log":
        return renderLog();
      case "Settings":
        return renderSettings();
    }
    return h("div");
  }

  // ---- Export tab ----
  async function renderExport() {
    const listingId = state.listingId;
    const snapshot = await sGet(KEYS.snapshot(listingId));
    const settings = E.storageKeys.sanitizeSettings(await sGet(KEYS.settings));
    const busy = E.jobs.isBusy();

    const statusBits = [];
    if (snapshot && snapshot.keywords && snapshot.keywords.length) {
      const age = snapshot.exported_at ? Math.floor((Date.now() - Date.parse(snapshot.exported_at)) / 86400000) : null;
      statusBits.push(
        h(
          "div",
          { class: "row muted" },
          `Snapshot: ${snapshot.keywords.length} keywords, ` +
            (snapshot.complete ? "complete" : "PARTIAL") +
            (snapshot.exported_at ? `, exported ${snapshot.exported_at.slice(0, 10)}` : ", in progress") +
            (snapshot.filter_spend_gt_zero ? ", spend>0 only" : "")
        )
      );
      if (age != null && age > settings.stale_export_days) {
        statusBits.push(h("div", { class: "warn" }, `Snapshot is ${age} days old — stats and keyword set may have changed; re-export recommended.`));
      }
      if (!snapshot.complete) {
        statusBits.push(h("div", { class: "warn" }, "Snapshot is partial (job interrupted). You can resume or export the partial data with caution."));
      }
    } else {
      statusBits.push(h("div", { class: "row muted" }, "No snapshot yet for this listing."));
    }

    const resumable =
      snapshot && snapshot.job && ["paused", "failed"].includes(snapshot.job.status) && !snapshot.complete;

    return h(
      "div",
      null,
      h("div", { class: "row" }, h("b", null, `Listing ${listingId}`), snapshot && snapshot.listing_title ? h("div", { class: "muted" }, snapshot.listing_title.slice(0, 90)) : null),
      statusBits,
      h(
        "div",
        { class: "chk" },
        h("input", {
          type: "checkbox",
          id: "spendOnly",
          checked: settings.only_spend_gt_zero,
          disabled: busy,
          onchange: async (ev) => {
            // Read the event BEFORE any await — afterwards ev.target is gone.
            const checked = ev.target.checked;
            const s = E.storageKeys.sanitizeSettings(await sGet(KEYS.settings));
            s.only_spend_gt_zero = checked;
            await sSet({ [KEYS.settings]: s });
          },
        }),
        h("label", { for: "spendOnly" }, "Collect only keywords with Spend > 0 (sorts by Spend, stops at the first all-zero page)")
      ),
      h(
        "button",
        {
          class: "btn",
          disabled: busy,
          onclick: () => {
            state.flash = null;
            state.progress = { label: "Starting export…", pct: 0 };
            render();
            E.jobs.runExport(state.listingId).catch(() => {});
          },
        },
        "Export keywords"
      ),
      resumable
        ? h(
            "button",
            {
              class: "btn secondary",
              disabled: busy,
              onclick: () => {
                state.flash = null;
                state.progress = { label: "Resuming export…", pct: 0 };
                render();
                E.jobs.runExport(state.listingId, { resume: true }).catch(() => {});
              },
            },
            `Resume export (page ${snapshot.job.current_page} of ${snapshot.job.pages_total || "?"})`
          )
        : null,
      snapshot && snapshot.keywords && snapshot.keywords.length
        ? h(
            "div",
            null,
            h(
              "button",
              {
                class: "btn secondary",
                disabled: busy,
                onclick: async () => {
                  const resp = await chrome.runtime.sendMessage({ type: "BUILD_ZIP", listingId: state.listingId });
                  if (resp && resp.ok) setFlash("ok", `ZIP ready: ${resp.filename}` + (resp.imageIncluded ? " (image included)" : " (image as URL)"));
                  else setFlash("error", "ZIP failed: " + (resp ? resp.error : "no response"));
                },
              },
              "Download ZIP for AI"
            ),
            h(
              "button",
              {
                class: "btn secondary",
                onclick: async () => {
                  const snap = await sGet(KEYS.snapshot(state.listingId));
                  await navigator.clipboard.writeText(E.csv.keywordsToCsv(snap.keywords));
                  setFlash("ok", `Copied ${snap.keywords.length} keywords as CSV.`);
                },
              },
              "Copy CSV"
            )
          )
        : null,
      h(
        "button",
        {
          class: "btn secondary",
          title: "Copies a snippet of the table markup + what the extension parsed from it — for debugging selector drift.",
          onclick: async () => {
            const diag = E.jobs.collectDiagnostics(state.listingId);
            await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
            setFlash("ok", "Diagnostics copied to clipboard — paste it to the developer.");
          },
        },
        "Copy diagnostics"
      )
    );
  }

  // ---- Import tab ----
  async function renderImport() {
    const listingId = state.listingId;
    const snapshot = await sGet(KEYS.snapshot(listingId));
    const session = await sGet(KEYS.importSession(listingId));
    const profile = (await sGet(KEYS.productProfile(listingId))) || {
      listing_id: String(listingId),
      title: (snapshot && snapshot.listing_title) || "",
      product_type: "",
      niche: "",
      audience: "",
      relevant_themes: [],
      irrelevant_themes: [],
      notes: "",
    };

    if (!snapshot || !snapshot.keywords || !snapshot.keywords.length) {
      return h("div", { class: "warn" }, "Export a snapshot first — import needs it for matching.");
    }

    const profileField = (label, key, isArray) =>
      h(
        "label",
        { class: "field" },
        label,
        h("input", {
          type: "text",
          value: isArray ? (profile[key] || []).join(", ") : profile[key] || "",
          onchange: async (ev) => {
            profile[key] = isArray
              ? ev.target.value.split(",").map((s) => s.trim()).filter(Boolean)
              : ev.target.value;
            await sSet({ [KEYS.productProfile(listingId)]: profile });
          },
        })
      );

    return h(
      "div",
      null,
      session && session.gate
        ? h("div", { class: "ok" }, `Import session: ${session.match ? session.match.matched.length : 0} matched, gate: ${session.gate}`)
        : null,
      h(
        "label",
        { class: "field" },
        "Import ai_results.json (file)",
        h("input", {
          type: "file",
          accept: ".json,application/json",
          onchange: (ev) => importAiFile(ev.target.files[0]),
        })
      ),
      h(
        "label",
        { class: "field" },
        "…or paste the AI's JSON answer here",
        h("textarea", { id: "aiPasteBox", placeholder: '{ "schema_version": 1, "listing_id": "…", "results": [...] }', rows: "4" })
      ),
      h(
        "button",
        {
          class: "btn",
          id: "aiPasteImport",
          onclick: async () => {
            const box = shadow.querySelector("#aiPasteBox");
            const text = box ? box.value.trim() : "";
            if (!text) {
              setFlash("warn", "Paste the AI's JSON into the box first.");
              return;
            }
            await importAiText(text);
          },
        },
        "Import pasted JSON"
      ),
      h("div", { class: "muted row" }, "Product profile (embedded into the export so the AI knows the product):"),
      profileField("Product type", "product_type"),
      profileField("Niche", "niche"),
      profileField("Audience", "audience"),
      profileField("Relevant themes (comma-separated)", "relevant_themes", true),
      profileField("Irrelevant themes (comma-separated)", "irrelevant_themes", true),
      h(
        "label",
        { class: "field" },
        "Notes for the AI",
        h("textarea", {
          onchange: async (ev) => {
            profile.notes = ev.target.value;
            await sSet({ [KEYS.productProfile(listingId)]: profile });
          },
        }, profile.notes || "")
      )
    );
  }

  async function importAiFile(file) {
    if (!file) return;
    await importAiText(await file.text());
  }

  /** Strip accidental markdown fences the AI may wrap around the JSON. */
  function stripJsonFences(text) {
    return String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  }

  async function importAiText(rawText) {
    const listingId = state.listingId;
    const snapshot = await sGet(KEYS.snapshot(listingId));
    if (!snapshot || !snapshot.keywords || !snapshot.keywords.length) {
      setFlash("error", "No snapshot for this listing — run Export first.");
      return;
    }
    const text = stripJsonFences(rawText);
    const validation = E.schemas.validateAiResults(text, listingId);
    if (!validation.ok) {
      setFlash("error", "Import rejected:\n• " + validation.errors.join("\n• "));
      return;
    }
    const match = E.schemas.matchAgainstSnapshot(validation.results, snapshot);

    // Default selection: actionable + currently enabled + not zero-spend group.
    const selection = {};
    for (const m of match.matched) {
      const ov = E.classification.applySafetyOverride(m.keyword, m.ai.classification);
      if (
        E.classification.isActionable(ov.classification) &&
        !ov.zero_spend_group &&
        m.keyword.currently_enabled !== false
      ) {
        selection[m.keyword.keyword_normalized] = true;
      }
    }

    const session = {
      schema_version: 1,
      listing_id: String(listingId),
      imported_at: new Date().toISOString(),
      snapshot_exported_at: snapshot.exported_at,
      results: validation.results,
      match: {
        matched: match.matched,
        unmatched_in_ai: match.unmatched_in_ai,
        not_covered_in_snapshot: match.not_covered_in_snapshot,
      },
      selection,
      selection_hash: null,
      gate: "imported", // imported → previewed → dry_run_ok → executing → done
      dry_run_report: null,
      dry_run_ok: false,
      job: null,
    };
    await sSet({ [KEYS.importSession(listingId)]: session });
    await E.logger.log({
      listing_id: listingId,
      event: "IMPORT_VALIDATED",
      detail: { results: validation.results.length, matched: match.matched.length, unmatched: match.unmatched_in_ai.length },
    });
    const coerced = validation.results.filter((r) => r.coerced).length;
    switchTab("Preview");
    setFlash(
      "ok",
      `Imported: ${match.matched.length} matched, ${match.unmatched_in_ai.length} unmatched` +
        (coerced ? `, ${coerced} unknown classifications coerced to REVIEW` : "") +
        "."
    );
  }

  async function markPreviewed() {
    const session = await sGet(KEYS.importSession(state.listingId));
    if (session && session.gate === "imported") {
      session.gate = "previewed";
      await sSet({ [KEYS.importSession(state.listingId)]: session });
    }
  }

  // ---- Preview tab ----
  async function renderPreview() {
    const listingId = state.listingId;
    const session = await sGet(KEYS.importSession(listingId));
    const snapshot = await sGet(KEYS.snapshot(listingId));
    if (!session || !session.match) return h("div", { class: "muted" }, "No import session. Import ai_results.json first.");

    const settings = E.storageKeys.sanitizeSettings(await sGet(KEYS.settings));
    if (snapshot && snapshot.exported_at) {
      const age = Math.floor((Date.now() - Date.parse(snapshot.exported_at)) / 86400000);
      if (age > settings.stale_export_days) {
        // stale warning is appended into groups below
        session._stale = age;
      }
    }

    const groups = { DISABLE_IRRELEVANT: [], DISABLE_BROAD: [], DISABLE_NO_CONVERSION: [], zero_spend: [], REVIEW: [], KEEP: [] };
    for (const m of session.match.matched) {
      const ov = E.classification.applySafetyOverride(m.keyword, m.ai.classification);
      const item = { m, ov };
      if (ov.zero_spend_group) groups.zero_spend.push(item);
      else if (groups[ov.classification]) groups[ov.classification].push(item);
      else groups.REVIEW.push(item);
    }

    const selection = session.selection || {};
    const persistSelection = async () => {
      session.selection = selection;
      // Selection change invalidates a previous dry run (SPEC §27).
      if (session.gate === "dry_run_ok") session.gate = "previewed";
      session.dry_run_ok = false;
      await sSet({ [KEYS.importSession(listingId)]: session });
      render();
    };

    const kwRow = (item, actionable) => {
      const kw = item.m.keyword;
      const norm = kw.keyword_normalized;
      const locked = kw.currently_enabled === false;
      return h(
        "div",
        { class: "kwrow" + (locked ? " locked" : "") },
        actionable
          ? h("input", {
              type: "checkbox",
              checked: !locked && Boolean(selection[norm]),
              disabled: locked,
              onchange: (ev) => {
                if (ev.target.checked) selection[norm] = true;
                else delete selection[norm];
                persistSelection();
              },
            })
          : null,
        h("span", { class: "kw", title: item.m.ai.reason || "" }, norm),
        locked ? h("span", { class: "badge" }, "already off") : null,
        item.ov.downgraded ? h("span", { class: "badge", title: item.ov.note }, "downgraded") : null,
        h("span", { class: "stat" }, `$${kw.spend} · ${kw.clicks}c · ${kw.views}v`)
      );
    };

    const group = (title, items, actionable, openByDefault) =>
      items.length
        ? h(
            "details",
            { class: "group", ...(openByDefault ? { open: "" } : {}) },
            h("summary", null, `${title} (${items.length})`),
            actionable
              ? h(
                  "div",
                  { class: "rows" },
                  h(
                    "div",
                    { class: "chk" },
                    h("input", {
                      type: "checkbox",
                      checked: items.every((i) => i.m.keyword.currently_enabled === false || selection[i.m.keyword.keyword_normalized]),
                      onchange: (ev) => {
                        for (const i of items) {
                          const kw = i.m.keyword;
                          if (kw.currently_enabled === false) continue;
                          if (ev.target.checked) selection[kw.keyword_normalized] = true;
                          else delete selection[kw.keyword_normalized];
                        }
                        persistSelection();
                      },
                    }),
                    h("span", { class: "muted" }, "select all")
                  ),
                  items.map((i) => kwRow(i, true))
                )
              : h("div", { class: "rows" }, items.map((i) => kwRow(i, false))),
          )
        : null;

    const selectedNorms = Object.keys(selection);
    const totalSpend = session.match.matched
      .filter((m) => selection[m.keyword.keyword_normalized])
      .reduce((s, m) => s + (m.keyword.spend || 0), 0);

    return h(
      "div",
      null,
      session._stale ? h("div", { class: "warn" }, `Snapshot is ${session._stale} days old — re-export recommended before disabling.`) : null,
      h("div", { class: "row" }, h("b", null, `${selectedNorms.length} selected`), h("span", { class: "muted" }, ` · $${totalSpend.toFixed(2)} spend represented`)),
      group("Irrelevant", groups.DISABLE_IRRELEVANT, true, true),
      group("Too broad", groups.DISABLE_BROAD, true, true),
      group("No conversion", groups.DISABLE_NO_CONVERSION, true, true),
      group("Zero-spend disables (off by default)", groups.zero_spend, true, false),
      group("Review (read-only)", groups.REVIEW, false, false),
      group("Keep (read-only)", groups.KEEP, false, false),
      session.match.unmatched_in_ai.length
        ? h(
            "details",
            { class: "group" },
            h("summary", null, `Unmatched AI keywords (${session.match.unmatched_in_ai.length}) — cannot be acted on`),
            h("div", { class: "rows" }, session.match.unmatched_in_ai.map((r) => h("div", { class: "kwrow" }, h("span", { class: "kw" }, r.keyword_normalized))))
          )
        : null,
      h(
        "button",
        {
          class: "btn",
          disabled: E.jobs.isBusy() || !selectedNorms.length || session.gate === "executing",
          onclick: async () => {
            session.selection_hash = selectionHash(selectedNorms);
            session.gate = "previewed";
            await sSet({ [KEYS.importSession(listingId)]: session });
            await E.logger.log({ listing_id: listingId, event: "PREVIEW_CONFIRMED", detail: { selected: selectedNorms.length } });
            state.flash = null;
            state.progress = { label: "Dry run starting…", pct: 0 };
            switchTab("Run");
            E.jobs.runDryRun(listingId, selectedNorms).catch(() => {});
          },
        },
        `Run Dry Run (${selectedNorms.length})`
      ),
      h(
        "button",
        {
          class: "btn secondary",
          onclick: async () => {
            await chrome.storage.local.remove(KEYS.importSession(listingId));
            setFlash("warn", "Import session cancelled.");
          },
        },
        "Cancel import"
      )
    );
  }

  // ---- Run tab ----
  async function renderRun() {
    const listingId = state.listingId;
    const session = await sGet(KEYS.importSession(listingId));
    if (!session) return h("div", { class: "muted" }, "No import session.");
    const report = session.dry_run_report;
    const selectedNorms = Object.keys(session.selection || {});
    const busy = E.jobs.isBusy();

    const parts = [];
    if (!report) {
      parts.push(h("div", { class: "muted" }, "Run a Dry Run from the Preview tab first."));
    } else {
      parts.push(
        h(
          "div",
          { class: "row" },
          h("div", null, h("b", null, "Dry run report")),
          h("div", { class: "muted" }, `found: ${report.found.length} · not found: ${report.not_found.length} · already off: ${report.already_disabled.length} · unreadable: ${report.state_unreadable.length}`)
        )
      );
      if (report.not_found.length) {
        parts.push(
          h("div", { class: "warn" }, `${report.not_found.length} selected keywords were not found on the page: ` + report.not_found.slice(0, 10).join(", ") + (report.not_found.length > 10 ? "…" : ""))
        );
      }
      if (report.state_unreadable.length) {
        parts.push(h("div", { class: "warn" }, `${report.state_unreadable.length} keywords have unreadable toggle state and are excluded from the run.`));
      }
    }

    const currentHash = selectionHash(selectedNorms);
    const hashOk = session.selection_hash === currentHash;
    const runSet = report ? report.found : [];
    let proceedSubset = false;

    const canDisable =
      session.gate === "dry_run_ok" && session.dry_run_ok && hashOk && runSet.length > 0 && !busy;

    const subsetNeeded = report && report.not_found.length > 0;
    const subsetChk = subsetNeeded
      ? h(
          "div",
          { class: "chk" },
          h("input", {
            type: "checkbox",
            id: "subsetOk",
            onchange: (ev) => {
              proceedSubset = ev.target.checked;
              disableBtn.disabled = !(canDisable && (!subsetNeeded || proceedSubset));
            },
          }),
          h("label", { for: "subsetOk" }, `Proceed with found subset only (${runSet.length} of ${selectedNorms.length})`)
        )
      : null;

    const disableBtn = h(
      "button",
      {
        class: "btn danger",
        disabled: !(canDisable && !subsetNeeded),
        onclick: async () => {
          if (!confirm(`This will turn off ${runSet.length} keywords on Etsy. Continue?`)) return;
          state.flash = null;
          state.progress = { label: "Disable run starting…", pct: 0 };
          render();
          E.jobs.runDisable(listingId, runSet).catch(() => {});
        },
      },
      `Disable ${runSet.length} keywords`
    );

    if (report && !hashOk) {
      parts.push(h("div", { class: "warn" }, "Selection changed since the dry run — re-run the Dry Run from Preview."));
    }

    const resumable = session.job && session.job.type === "disable" && session.job.status === "paused";
    if (resumable) {
      parts.push(
        h(
          "button",
          {
            class: "btn secondary",
            disabled: busy,
            onclick: () => {
              state.progress = { label: "Resuming disable run…", pct: 0 };
              render();
              E.jobs.runDisable(listingId, runSet).catch(() => {});
            },
          },
          `Resume disable run (${(session.job.processed_keys || []).length} done)`
        )
      );
    }

    if (session.disable_report) {
      const r = session.disable_report;
      parts.push(
        h("div", { class: "ok" }, `Disable run: ${r.disabled_ok.length} disabled, ${r.skipped_already.length} already off, ${r.failed.length} failed, ${r.unreadable.length} unreadable.`)
      );
    }

    parts.push(subsetChk, disableBtn);
    return h("div", null, parts.filter(Boolean));
  }

  // ---- Log tab ----
  async function renderLog() {
    const entries = await E.logger.readAll();
    const recent = entries.slice(0, 100);
    return h(
      "div",
      null,
      h(
        "div",
        { class: "flex row" },
        h(
          "button",
          {
            class: "btn secondary",
            onclick: async () => {
              const all = await E.logger.readAll();
              const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "eakm-operation-log.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            },
          },
          "Export log JSON"
        ),
        h(
          "button",
          {
            class: "btn secondary",
            onclick: async () => {
              await E.logger.clear();
              render();
            },
          },
          "Clear"
        )
      ),
      recent.length
        ? recent.map((e) =>
            h(
              "div",
              { class: "logent " + (e.level || "info") },
              h("span", { class: "ev" }, e.event),
              ` ${e.keyword ? '"' + e.keyword + '" ' : ""}${e.page ? "p" + e.page + " " : ""}`,
              h("span", { class: "muted" }, (e.ts || "").replace("T", " ").slice(0, 19))
            )
          )
        : h("div", { class: "muted" }, "Log is empty.")
    );
  }

  // ---- Settings tab ----
  async function renderSettings() {
    const settings = E.storageKeys.sanitizeSettings(await sGet(KEYS.settings));
    const FIELDS = [
      ["target_min_roas", "Target min ROAS"],
      ["break_even_roas", "Break-even ROAS"],
      ["max_spend_without_order", "Max spend without order ($)"],
      ["min_clicks_for_decision", "Min clicks for decision"],
      ["click_delay_ms", "Click delay (ms, min 500)"],
      ["page_delay_ms", "Page delay (ms, min 1000)"],
      ["toggle_verify_timeout_ms", "Toggle verify timeout (ms)"],
      ["pagination_settle_timeout_ms", "Pagination settle timeout (ms)"],
      ["table_wait_timeout_ms", "Table wait timeout (ms)"],
      ["stale_export_days", "Stale export warning (days)"],
      ["log_max_entries", "Max log entries"],
    ];
    return h(
      "div",
      null,
      FIELDS.map(([key, label]) =>
        h(
          "label",
          { class: "field" },
          label,
          h("input", {
            type: "number",
            value: settings[key],
            onchange: async (ev) => {
              // Read the event BEFORE any await — afterwards ev.target is gone.
              const value = Number(ev.target.value);
              const s = E.storageKeys.sanitizeSettings(await sGet(KEYS.settings));
              s[key] = value;
              await sSet({ [KEYS.settings]: E.storageKeys.sanitizeSettings(s) });
              render(); // re-render shows clamped value
            },
          })
        )
      ),
      h(
        "button",
        {
          class: "btn secondary",
          onclick: async () => {
            await sSet({ [KEYS.settings]: E.storageKeys.DEFAULT_SETTINGS });
            render();
          },
        },
        "Reset to defaults"
      )
    );
  }

  return { mount, unmount, toggleCollapsed, render, selectionHash };
});
