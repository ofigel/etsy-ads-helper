/**
 * ALL Etsy DOM selectors and structural heuristics live here and ONLY here
 * (SPEC §10). When Etsy changes its markup, this is the single file to patch.
 *
 * Each named selector is {primary, fallbacks[], description}. resolve() tries
 * them in order and reports which one matched so selector drift shows up in
 * the operation log.
 *
 * The listing-stats page is a React SPA: the keywords table does NOT exist in
 * the server HTML. Callers must use waitFor()-style detection, never assume
 * presence at document_idle.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.domSelectors = mod;
})(globalThis, function () {
  "use strict";

  const SELECTORS = {
    listingTitle: {
      primary: "h1",
      fallbacks: ['[data-listing-title]', "h2"],
      description: "Listing title heading near the top of the stats page",
    },
    listingThumb: {
      primary: 'img[src*="i.etsystatic.com"]',
      fallbacks: ["img"],
      description: "Product thumbnail image near the listing title",
    },
    dateRangeLabel: {
      primary: 'button[aria-haspopup] span',
      fallbacks: ["button[aria-expanded]"],
      description: 'Date period selector, e.g. "Last 30 days (May 12 - Jun 11)"',
    },
    signinForm: {
      primary: 'form[action*="signin"], input[name="email"][type="email"]',
      fallbacks: ['[data-signin]', 'a[href*="/signin"]'],
      description: "Sign-in form shown when the session is logged out",
    },
    captchaFrame: {
      primary:
        'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]',
      fallbacks: [],
      description: "Captcha/challenge iframe used for throttle detection",
    },
  };

  /**
   * Try primary then fallbacks; return {el, selector, index} or null.
   */
  function resolve(name, rootEl) {
    const spec = SELECTORS[name];
    if (!spec) throw new Error("Unknown selector name: " + name);
    const scope = rootEl || document;
    const candidates = [spec.primary, ...spec.fallbacks];
    for (let i = 0; i < candidates.length; i++) {
      try {
        const el = scope.querySelector(candidates[i]);
        if (el) return { el, selector: candidates[i], index: i };
      } catch (e) {
        /* invalid selector in fallback chain — skip */
      }
    }
    return null;
  }

  // ---- Keywords table identification (SPEC §10.2) ----

  const HEADER_REQUIRED = ["targeted keyword", "spend", "clicks", "views"];

  function normalizeHeaderText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[▲▼↑↓]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** All candidate "tables": real tables plus ARIA grids. */
  function candidateTables(doc) {
    const d = doc || document;
    return [
      ...d.querySelectorAll("table"),
      ...d.querySelectorAll('[role="table"], [role="grid"]'),
    ];
  }

  function headerCellsOf(table) {
    let cells = table.querySelectorAll("thead th");
    if (!cells.length) cells = table.querySelectorAll('[role="columnheader"]');
    if (!cells.length) {
      const firstRow = table.querySelector("tr");
      if (firstRow) cells = firstRow.querySelectorAll("th, td");
    }
    return [...cells];
  }

  /**
   * Find the targeted-keywords table.
   * Primary: header row contains the required column names.
   * Fallback A: table inside a container whose heading matches
   *   /targeted keywords \(\d+\)/i.
   * Fallback B: the only table with a column of toggle/switch controls.
   * Returns {table, via} or null.
   */
  function findKeywordsTable(doc) {
    const d = doc || document;
    const tables = candidateTables(d);

    for (const t of tables) {
      const headers = headerCellsOf(t).map((c) => normalizeHeaderText(c.textContent));
      if (HEADER_REQUIRED.every((h) => headers.some((x) => x.startsWith(h)))) {
        return { table: t, via: "header-match" };
      }
    }

    const headingRe = /targeted keywords\s*\(\d+\)/i;
    const headings = [...d.querySelectorAll("h1,h2,h3,h4,span,div,button")].filter(
      (el) => el.childElementCount === 0 && headingRe.test(el.textContent || "")
    );
    for (const h of headings) {
      let scope = h;
      for (let up = 0; up < 8 && scope; up++) {
        const t = scope.querySelector ? scope.querySelector("table") : null;
        if (t) return { table: t, via: "heading-container" };
        scope = scope.parentElement;
      }
    }

    const withToggles = tables.filter((t) =>
      t.querySelector('input[type="checkbox"], [role="switch"], button[aria-pressed]')
    );
    if (withToggles.length === 1) {
      return { table: withToggles[0], via: "toggle-column" };
    }
    return null;
  }

  /** Parse expected keyword count from "Targeted keywords (706)". */
  function findExpectedKeywordCount(doc) {
    const d = doc || document;
    const m = (d.body ? d.body.textContent : "").match(/targeted keywords\s*\((\d+)\)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Body rows of the keywords table (re-queried fresh on every call). */
  function bodyRowsOf(table) {
    let rows = [...table.querySelectorAll("tbody tr")];
    if (!rows.length) {
      rows = [...table.querySelectorAll('[role="row"]')].filter(
        (r) => !r.querySelector('[role="columnheader"]')
      );
    }
    if (!rows.length) {
      rows = [...table.querySelectorAll("tr")].filter((r) => !r.querySelector("th"));
    }
    return rows;
  }

  // ---- Toggle controls (SPEC §10.4) ----

  /**
   * Find the relevance toggle within a row. Searched from the LAST cell
   * backwards (the "Relevant keyword" column is rightmost).
   * Returns {el, kind} or null.
   */
  function findRowToggle(row) {
    const cells = row.cells ? [...row.cells] : [...row.querySelectorAll('[role="cell"], td')];
    const scopes = cells.length ? cells.slice().reverse() : [row];
    const matchers = [
      { sel: 'input[type="checkbox"]', kind: "checkbox" },
      { sel: '[role="switch"]', kind: "switch" },
      { sel: "button[aria-pressed]", kind: "aria-button" },
    ];
    for (const scope of scopes) {
      for (const m of matchers) {
        const el = scope.querySelector(m.sel);
        if (el) return { el, kind: m.kind };
      }
    }
    return null;
  }

  /**
   * Read toggle state → true (enabled) / false (disabled) / null (unreadable).
   * Checks .checked, aria-checked, aria-pressed; Etsy's data-checked-label /
   * data-unchecked-label attributes are used only as a last-resort hint.
   */
  function readToggleState(toggleEl) {
    if (!toggleEl) return null;
    if (typeof toggleEl.checked === "boolean") return toggleEl.checked;
    const ariaChecked = toggleEl.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;
    const ariaPressed = toggleEl.getAttribute("aria-pressed");
    if (ariaPressed === "true") return true;
    if (ariaPressed === "false") return false;
    // Hint only: a nested input may carry the state.
    const inner = toggleEl.querySelector && toggleEl.querySelector('input[type="checkbox"]');
    if (inner && typeof inner.checked === "boolean") return inner.checked;
    return null;
  }

  // ---- Pagination (SPEC §22) ----

  /**
   * Locate pagination controls near the table.
   * Returns {container, next, prev, current, pageButtons[]} (fields nullable).
   */
  function findPagination(table) {
    const d = table.ownerDocument || document;
    let container =
      d.querySelector('nav[aria-label*="pagination" i]') ||
      d.querySelector('[role="navigation"][aria-label*="page" i]');

    if (!container) {
      // Walk up from the table looking for a sibling block with numbered buttons.
      let scope = table.parentElement;
      for (let up = 0; up < 8 && scope; up++) {
        const btns = [...scope.querySelectorAll("button, a")].filter((b) =>
          /^\d+$/.test((b.textContent || "").trim())
        );
        if (btns.length >= 2) {
          container = scope;
          break;
        }
        scope = scope.parentElement;
      }
    }
    if (!container) return null;

    const all = [...container.querySelectorAll("button, a")];
    const pageButtons = all.filter((b) => /^\d+$/.test((b.textContent || "").trim()));
    const byLabel = (re) =>
      all.find((b) => re.test(b.getAttribute("aria-label") || "") || re.test(b.textContent || ""));
    const next = byLabel(/next|→/i) || null;
    const prev = byLabel(/prev|previous|←/i) || null;
    const current =
      pageButtons.find(
        (b) =>
          b.getAttribute("aria-current") ||
          b.matches('[aria-selected="true"], [data-selected="true"]')
      ) || null;
    return { container, next, prev, current, pageButtons };
  }

  function isDisabledControl(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    return false;
  }

  /** Total pages from the numbered buttons ("… 48 →"), else null. */
  function readPagesTotal(pagination) {
    if (!pagination || !pagination.pageButtons.length) return null;
    const nums = pagination.pageButtons
      .map((b) => parseInt((b.textContent || "").trim(), 10))
      .filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : null;
  }

  /** Current page number, else null. */
  function readCurrentPage(pagination) {
    if (!pagination) return null;
    if (pagination.current) {
      const n = parseInt((pagination.current.textContent || "").trim(), 10);
      if (Number.isFinite(n)) return n;
    }
    const cur = pagination.pageButtons.find(
      (b) => b.getAttribute("aria-current") === "page" || b.getAttribute("aria-current") === "true"
    );
    if (cur) {
      const n = parseInt((cur.textContent || "").trim(), 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  /** The header cell ("th"/columnheader) of the Spend column, or null. */
  function findSpendHeaderCell(table) {
    const cells = headerCellsOf(table);
    for (const c of cells) {
      if (normalizeHeaderText(c.textContent).startsWith("spend")) return c;
    }
    return null;
  }

  /**
   * Clickable candidates for triggering Spend sort, most specific first.
   * Real Etsy markup may wrap the label in a button, a link, a role=button
   * element, a focusable span — or make the th itself clickable, so the
   * caller tries them in order until one provokes a change.
   */
  function findSpendSortControls(table) {
    const th = findSpendHeaderCell(table);
    if (!th) return [];
    const out = [];
    for (const sel of ["button", "a", '[role="button"]', "[tabindex]", "span"]) {
      const el = th.querySelector(sel);
      if (el && !out.includes(el)) out.push(el);
    }
    out.push(th);
    return out;
  }

  /**
   * Current sort state of the Spend column: "asc" | "desc" | null (unknown).
   * Signals, in priority order: aria-sort on the header cell or any
   * descendant, then arrow glyphs in the header text.
   */
  function readSpendSortState(table) {
    const th = findSpendHeaderCell(table);
    if (!th) return null;
    let aria = th.getAttribute("aria-sort");
    if (!aria) {
      const inner = th.querySelector("[aria-sort]");
      if (inner) aria = inner.getAttribute("aria-sort");
    }
    if (aria) {
      if (/^desc/i.test(aria)) return "desc";
      if (/^asc/i.test(aria)) return "asc";
      return null; // "none"
    }
    const txt = th.textContent || "";
    if (/[▼▾↓]/.test(txt)) return "desc";
    if (/[▲▴↑]/.test(txt)) return "asc";
    return null;
  }

  /** Sortable "Spend" header control inside the table header. */
  function findSpendSortControl(table) {
    const controls = findSpendSortControls(table);
    return controls.length ? controls[0] : null;
  }

  return {
    SELECTORS,
    resolve,
    normalizeHeaderText,
    findKeywordsTable,
    findExpectedKeywordCount,
    headerCellsOf,
    bodyRowsOf,
    findRowToggle,
    readToggleState,
    findPagination,
    isDisabledControl,
    readPagesTotal,
    readCurrentPage,
    findSpendHeaderCell,
    findSpendSortControls,
    readSpendSortState,
    findSpendSortControl,
  };
});
