# Etsy Ads Keyword Manager — Chrome Extension MVP
## Implementation Specification for AI Coding Agent (Claude Code)

> **How to use this document:** Implement strictly in the order given in §35. Do not skip validation, dry run, storage, or operation logs. All Etsy DOM selectors MUST live in a single `src/content/domSelectors.js` module so they can be patched without touching logic. The keywords table is **client-side rendered (React SPA)** — never assume the table exists at `document_idle`; use the detection strategy in §10.

---

## 1. MVP Goal

A Manifest V3 Chrome extension that lets an Etsy seller:
1. **Export** all targeted keywords (with stats) from an Etsy Ads listing-stats page into a local snapshot + downloadable ZIP.
2. Analyze the keywords **manually with any external AI** (ChatGPT/Claude web UI) using a generated prompt + JSON.
3. **Import** the AI's classification JSON back into the extension.
4. **Preview** proposed changes, run a **Dry Run**, then safely **disable** selected keywords on the Etsy page via UI automation, with full operation logging.

Target page: `https://www.etsy.com/your/shops/me/advertising/listings/{listing_id}*`
Observed real-world scale: **706 keywords across 48 pages (~15 rows/page)** on a single listing. The extension must handle this without timeouts or data loss.

## 2. Non-Goals / v2 Features

NOT in v1: OpenAI/Anthropic API integration; multi-listing batch mode; Amazon/Shopify/Redbubble support; cloud backend or accounts; re-enable/rollback execution (schema support only, §32); keyword bid management; analytics dashboards; auto-classification heuristics beyond the profitability pre-labeling in §20.

## 3. Chrome Extension Architecture

```
┌─────────────┐  chrome.runtime messages  ┌──────────────────┐
│  Popup UI    │◄────────────────────────►│ Background SW     │
│ (controller) │                           │ (state, storage,  │
└──────┬───────┘                           │  ZIP, downloads)  │
       │ chrome.tabs.sendMessage           └────────┬─────────┘
       ▼                                            │ chrome.storage.local
┌──────────────────────────┐                        ▼
│ Content Script (Etsy tab) │              ┌────────────────┐
│ - DOM extraction          │              │ Local storage   │
│ - pagination driver       │              │ snapshots, jobs,│
│ - toggle automation       │              │ logs, settings  │
└──────────────────────────┘              └────────────────┘
```

- **No external network calls** except optional product-image fetch from Etsy's own CDN (`i.etsystatic.com`).
- All long-running jobs (export crawl, disable run) are driven by the content script with state checkpointed to `chrome.storage.local` after every page (§23).
- Popup is stateless: it always reads current job/snapshot state from storage on open.

## 4. Required File Structure

```
etsy-ads-keyword-manager/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── serviceWorker.js        # message router, downloads, ZIP build
│   │   └── zipBuilder.js           # JSZip wrapper (bundled, no CDN)
│   ├── content/
│   │   ├── contentScript.js        # entry: page detection, message handlers
│   │   ├── domSelectors.js         # ALL selectors + fallbacks live here ONLY
│   │   ├── tableExtractor.js       # header mapping, row parsing
│   │   ├── paginator.js            # next-page navigation + settle detection
│   │   ├── toggleDriver.js         # find/click/verify keyword switches
│   │   └── pageGuards.js           # logged-in check, page-type check, throttle/captcha detection
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js                # tab views: Export / Import / Preview / Run / Log / Settings
│   │   └── popup.css
│   ├── shared/
│   │   ├── normalize.js            # keyword_normalization() — single source of truth
│   │   ├── schemas.js              # JSON schema definitions + validate()
│   │   ├── storageKeys.js          # storage key constants & versioning
│   │   ├── classification.js       # enums, profitability rules (§19–20)
│   │   └── logger.js               # operation log append/read
│   └── vendor/
│       └── jszip.min.js
├── fixtures/                        # real saved Etsy HTML for tests (provided by user)
│   └── listing-stats-page.html
├── tests/
│   ├── normalize.test.js
│   ├── tableExtractor.test.js      # runs against fixtures/ via jsdom
│   ├── schemas.test.js
│   └── classification.test.js
├── package.json                     # jest + jsdom for tests only; extension itself is build-free vanilla JS
└── README.md
```

No bundler. Plain ES modules where MV3 allows (`"type": "module"` for SW; content scripts via classic scripts with a tiny concat or `importScripts`-free pattern — if ESM in content scripts is awkward, inject as multiple `js` entries in manifest order: domSelectors → normalize → tableExtractor → paginator → toggleDriver → pageGuards → contentScript).

## 5. Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Etsy Ads Keyword Manager",
  "version": "0.1.0",
  "description": "Export, AI-review, and safely disable Etsy Ads targeted keywords.",
  "permissions": ["storage", "downloads", "activeTab", "scripting", "unlimitedStorage"],
  "host_permissions": [
    "https://www.etsy.com/your/shops/*",
    "https://i.etsystatic.com/*"
  ],
  "background": { "service_worker": "src/background/serviceWorker.js", "type": "module" },
  "content_scripts": [{
    "matches": ["https://www.etsy.com/your/shops/me/advertising/listings/*"],
    "js": [
      "src/content/domSelectors.js",
      "src/shared/normalize.js",
      "src/shared/storageKeys.js",
      "src/content/pageGuards.js",
      "src/content/tableExtractor.js",
      "src/content/paginator.js",
      "src/content/toggleDriver.js",
      "src/content/contentScript.js"
    ],
    "run_at": "document_idle"
  }],
  "action": { "default_popup": "src/popup/popup.html" }
}
```

Notes: `unlimitedStorage` because a 706-keyword snapshot + logs can exceed 5MB over time. No `tabs` permission needed — popup messages the active tab via `chrome.tabs.query({active:true,currentWindow:true})` (requires `activeTab`).

## 6. Content Script Responsibilities

- On injection: run `pageGuards` (§30 cases 1–2), report page status to background (`PAGE_STATUS` message: `{supported, listingId, loggedIn}`).
- Extract `listing_id` from URL: `/advertising/listings/(\d+)/`.
- Handle messages: `START_EXPORT`, `RESUME_EXPORT`, `START_DRY_RUN`, `START_DISABLE`, `ABORT_JOB`, `GET_PAGE_STATUS`.
- Drive pagination loops; checkpoint after every page; obey rate limits (§29).
- NEVER mutate the page during export — read-only. Mutations only in `toggleDriver` during a confirmed disable run.

## 7. Background Service Worker Responsibilities

- Message router between popup and content script.
- Owns `chrome.storage.local` writes for snapshots/settings (content script sends data up; SW persists — avoids concurrent-writer races).
- Builds export ZIP via bundled JSZip; triggers `chrome.downloads.download` with a data/blob URL.
- Fetches product image (§25) — done in SW to avoid page CSP issues.
- Keeps no in-memory state that can't be rebuilt from storage (MV3 SW can be killed anytime).

## 8. Popup UI Responsibilities

Single popup with tab views. Vanilla JS, no framework.

1. **Export tab** — listing detected (id + title if available), snapshot status (exists? date? stale? §24), buttons: *Export keywords* / *Resume export* (if interrupted job exists) / *Download ZIP*.
2. **Import tab** — file input for `ai_results.json`, validation result display (errors listed per §17), product-profile editor (§18).
3. **Preview tab** — table of proposed changes grouped by classification, checkboxes per keyword (user can deselect), counts, "Run Dry Run" button (enabled only after preview viewed).
4. **Run tab** — Dry Run report; *Disable keywords* button (enabled only after a successful dry run for the same import, §28); progress bar (page X of Y, keyword N of M); Abort button.
5. **Log tab** — last operations from the operation log, newest first; export log as JSON.
6. **Settings tab** — fields from §33 with validation + Reset to defaults.

The popup may be closed mid-job; jobs continue (driven by content script) and popup re-attaches to live progress via storage polling (500ms) or `chrome.runtime` port.

## 9. Data Flow

```
EXPORT:  content: crawl pages → rows[] ──► SW: persist snapshot ──► SW: build ZIP
         (read-only, checkpointed)         chrome.storage.local      └ keywords_data.json
                                                                     └ README.txt (AI prompt)
                                                                     └ product image | image_url.txt
USER:    uploads keywords_data.json + README prompt to ChatGPT/Claude manually
         downloads ai_results.json

IMPORT:  popup: read file → validate (§17) → match vs snapshot (§12) → store import session
PREVIEW: popup renders matched/unmatched/conflicts; user deselects; confirms
DRY RUN: content: walk pages, locate every selected keyword, report found/not-found/already-disabled. NO CLICKS.
DISABLE: content: walk pages, click toggles for selected keywords, verify each, log each (§28)
```

State gate enforcement (stored in import session): `imported → previewed → dry_run_ok → executing → done|aborted|failed`. Each step only reachable from the previous one. Any re-import resets the gate.

## 10. DOM Extraction Strategy

**Critical context:** the initial server HTML contains NO keywords table — it is rendered client-side. A view-source/static capture is useless; detection must be runtime-based.

1. **Wait-for-table:** `MutationObserver` on `document.body` + 250ms-debounced check for the keywords table (detected per §11 heuristic). Timeout: `settings.table_wait_timeout_ms` (default 20000) → error `TABLE_NOT_FOUND`.
2. **Table identification heuristic (in `domSelectors.js`):**
   - Primary: a `table` (or ARIA `role="table"` grid) whose header row contains, case-insensitively, at least: `targeted keyword`, `roas`, `spend`, `clicks`, `views`.
   - Fallback A: container near a heading matching `/targeted keywords \(\d+\)/i` — also parse the total count `(706)` from it for progress math.
   - Fallback B: the only on-page table with a column of toggle/switch controls (`input[type=checkbox][role=switch]`, `[role=switch]`, or button elements with two-state aria).
3. **Row parsing** must tolerate React re-renders: re-query rows fresh on every page; never hold element references across awaits longer than one action.
4. **Toggle control detection:** within the row's last cell, find the first element matching, in priority order: `input[type="checkbox"]`, `[role="switch"]`, `button[aria-pressed]`. State read: `.checked` ?? `aria-checked` ?? `aria-pressed` (string `"true"`/`"false"`). The shell HTML shows Etsy uses `data-checked-label`/`data-unchecked-label` attributes on toggle components elsewhere — check for these as an additional state hint, but do not rely on them.
5. Every selector in `domSelectors.js` is exported as `{primary, fallbacks[], description}`; a `resolve(name, root)` helper tries them in order and records which one matched into the operation log (selector drift telemetry).

## 11. Table Column Mapping (headers, not indexes)

Never use fixed `td` indexes. On each page:

```js
// pseudocode
headers = [...headerRow.cells].map(c => normalizeHeader(c.textContent));
// normalizeHeader: lowercase, trim, collapse whitespace, strip sort arrows/icons text
colMap = {
  keyword:  indexOfHeader(/^targeted keyword/),
  roas:     indexOfHeader(/^roas$/),
  orders:   indexOfHeader(/^orders$/),
  spend:    indexOfHeader(/^spend/),
  revenue:  indexOfHeader(/^revenue$/),
  clicks:   indexOfHeader(/^clicks$/),
  clickRate:indexOfHeader(/^click rate/),
  views:    indexOfHeader(/^views$/),
  relevant: indexOfHeader(/^relevant keyword/),
};
if (colMap.keyword == null || colMap.relevant == null) throw COLUMN_MAPPING_FAILED;
// any other missing column → warn in log, set field null, continue
```

Observed real columns (June 2026): `Targeted keyword | ROAS | Orders | Spend | Revenue | Clicks | Click rate | Views | Relevant keyword`.

Value parsing: money `$513.52 → 513.52` (strip `$`, `,`); percent `2.8% → 0.028`; numbers `1,234 → 1234`; empty/`—` → `0` for stats but `null` for ROAS if blank. Store raw text too (`*_raw`) for audit.

## 12. Keyword Identity Strategy

Canonical identity = `"{listing_id}::{keyword_normalized}"`.
- Etsy exposes no stable keyword IDs in the UI; row order and pagination change between sessions. NEVER generate synthetic IDs (uuid, row index) as persistent identity.
- All matching (import→snapshot, dry-run→page, disable→page) goes through normalized form.
- Collision rule: if two raw keywords normalize identically within one export (e.g. `women's shirt` vs `women&#39;s shirt`), keep one entry, merge stats by max(), record both raw forms in `raw_variants[]`, and flag `had_collision: true`.

## 13. keyword_normalization() — exact rules

Single implementation in `src/shared/normalize.js`, used everywhere (export, import matching, dry run, disable).

```js
function keyword_normalization(raw) {
  let s = String(raw ?? "");
  s = decodeHtmlEntities(s);          // &#39; → ' ; &amp; → & ; numeric & named. Use a textarea-based decoder in DOM contexts and a small entity map in tests.
  s = s.normalize("NFC");
  s = s.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, ""); // zero-width, soft hyphen, word joiner
  s = s.replace(/[\u2018\u2019\u02BC]/g, "'");             // curly/modifier apostrophes → ASCII '
  s = s.toLowerCase();
  s = s.replace(/\s+/g, " ").trim();                       // collapse ALL whitespace incl. NBSP (\s covers \u00A0? NO → add \u00A0 explicitly)
  s = s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
```

Apostrophes are **preserved** (meaningful: `women's 4th of july shirt` ≠ `womens 4th of july shirt` — both exist as separate Etsy keywords; confirmed in real data). Confirmed real input case: Etsy renders the literal text `women&#39;s 4th of july shirt` in the keyword cell — entity decoding is mandatory, not theoretical.

Required unit tests: entity decoding, curly apostrophe, NBSP, zero-width chars, case, multiple internal spaces, the `women's`/`womens` non-merge case.

## 14. Export Snapshot Structure in chrome.storage.local

```js
// key: `snapshot:${listing_id}`  (one snapshot per listing; new export overwrites, prior one is moved to `snapshot_prev:${listing_id}`)
{
  schema_version: 1,
  listing_id: "4467357077",
  listing_title: "America 250th Anniversary Shirt - ...",
  listing_url: "https://www.etsy.com/your/shops/me/advertising/listings/4467357077",
  exported_at: "2026-06-11T14:30:00.000Z",
  date_range_label: "Last 30 days (May 12 - Jun 11)",   // read from the period selector if found, else null
  totals: { views: 41700, clicks: 630, orders: 25, revenue: 685.75, spend: 513.52, roas: 1.34 }, // from the stats strip if found, else null
  expected_keyword_count: 706,        // parsed from "Targeted keywords (706)"
  pages_total: 48, pages_crawled: 48,
  complete: true,                     // false if aborted/partial
  keywords: [ /* KeywordRecord, see §15 */ ],
  job: null                           // or in-progress job state (§23)
}
// key: `import:${listing_id}` — current import session (ai results + match report + gate state)
// key: `oplog` — ring buffer array, max settings.log_max_entries
// key: `settings` — §33 object
// key: `product_profile:${listing_id}` — §18
```

## 15. Export JSON Schema (keywords_data.json in ZIP)

```json
{
  "schema_version": 1,
  "tool": "etsy-ads-keyword-manager/0.1.0",
  "listing_id": "4467357077",
  "listing_title": "string",
  "exported_at": "ISO-8601",
  "date_range_label": "string|null",
  "product_profile": { /* §18, embedded so the AI sees it */ },
  "instructions_for_ai": "<copy of the prompt from README.txt>",
  "totals": { "views": 0, "clicks": 0, "orders": 0, "revenue": 0, "spend": 0, "roas": 0 },
  "keywords": [
    {
      "key": "4467357077::women's 4th of july shirt",
      "keyword_normalized": "women's 4th of july shirt",
      "keyword_raw": "women&#39;s 4th of july shirt",
      "raw_variants": ["women&#39;s 4th of july shirt"],
      "roas": 0, "orders": 0, "spend": 0, "revenue": 0,
      "clicks": 0, "click_rate": 0, "views": 14,
      "currently_enabled": true,
      "prelabel": "REVIEW",            // §20 output, advisory for the AI
      "page_index": 1, "row_index": 7  // diagnostics only — NEVER identity
    }
  ]
}
```

## 16. AI Result JSON Schema (ai_results.json)

```json
{
  "schema_version": 1,
  "listing_id": "4467357077",
  "results": [
    {
      "keyword": "women's 4th of july shirt",      // normalized OR raw — importer normalizes again
      "classification": "KEEP|REVIEW|DISABLE_BROAD|DISABLE_IRRELEVANT|DISABLE_NO_CONVERSION",
      "reason": "string, optional, ≤300 chars"
    }
  ]
}
```
README.txt in the ZIP must contain the exact prompt instructing the AI to return ONLY this JSON, with the classification enum spelled out, and the rule "if unsure → REVIEW".

## 17. AI JSON Validation Rules

Reject file (show all errors, import nothing) if: not parseable JSON; `schema_version` missing/unsupported; `listing_id` missing; `results` not a non-empty array; any item missing `keyword` or `classification`; any `classification` not a string.
Per-item soft handling (import continues): unknown classification value → coerce to `REVIEW`, flag `coerced: true`; duplicate keyword in results → last one wins, flag; `reason` >300 chars → truncate.
**Hard gate:** `listing_id` mismatch vs active snapshot → block import entirely (error `LISTING_ID_MISMATCH`), no partial accept.
Match report after validation: `{matched: n, unmatched_in_ai: [...], not_covered_in_snapshot: n}`. Unmatched AI keywords are listed in Preview but can never be acted on.

## 18. Product Profile Schema (editable in popup)

```json
{
  "listing_id": "4467357077",
  "title": "string",
  "product_type": "graphic t-shirt",
  "niche": "patriotic / America 250th anniversary, vintage western style",
  "audience": "US buyers, men & women",
  "relevant_themes": ["america 250", "4th of july", "patriotic", "western cowboy", "1776-2026"],
  "irrelevant_themes": ["unrelated apparel types", "other holidays", "competitor brands"],
  "notes": "free text for the AI"
}
```
Embedded into export JSON so the external AI has product context. Defaults are auto-filled from page title; user edits persist per listing.

## 19. Classification Enum

`KEEP` | `REVIEW` | `DISABLE_BROAD` | `DISABLE_IRRELEVANT` | `DISABLE_NO_CONVERSION`
Only the three `DISABLE_*` values are actionable. `REVIEW` and `KEEP` are never acted on. Anything unknown → `REVIEW` (never auto-disable).

## 20. Profitability Pre-labeling Rules (advisory `prelabel`)

Settings-driven (§33): `target_min_roas` (default 2.0), `break_even_roas` (default 1.25), `max_spend_without_order` (default 5.00 USD), `min_clicks_for_decision` (default 8).

```
if orders > 0 and roas >= target_min_roas        → KEEP
if orders > 0 and roas <  break_even_roas        → REVIEW   // has sales but unprofitable — never auto-KEEP, never auto-DISABLE
if orders > 0                                     → REVIEW   // between break-even and target
if orders == 0 and spend >= max_spend_without_order and clicks >= min_clicks_for_decision
                                                  → DISABLE_NO_CONVERSION (suggested)
if orders == 0 and spend > 0 and (clicks < min_clicks_for_decision)
                                                  → REVIEW
if spend == 0                                     → KEEP-by-safety (see §21) → prelabel REVIEW, excluded from disable suggestions
```
Prelabels are hints embedded in the export; the AI's classification governs, but the extension re-applies §21 as a hard override at preview time.

## 21. Stop-at-Zero-Spend Safety Logic

Hard rule applied at Preview/Dry-Run/Disable regardless of AI output: a keyword with `spend == 0 AND clicks == 0` may still be classified `DISABLE_IRRELEVANT` by the AI (truly off-topic terms like `wtf is a kilometer shirt` cost nothing today but pollute targeting) — this is **allowed but visually separated** in Preview under "zero-spend disables" with its own select-all toggle, default **unchecked**. Keywords with `spend == 0` and classification `DISABLE_NO_CONVERSION` are **blocked** (contradiction: can't have no-conversion without spend) → downgraded to REVIEW with a visible note.

## 22. Pagination Handling

- Pagination control: numbered buttons `1 2 3 4 … 48` with prev/next arrows below the table.
- Driver uses **Next arrow** (not numbered jumps) for sequential crawl; detects last page when next is disabled/absent or current page number stops changing.
- After each click: wait for table content change — take a content hash (concat of first+last row keyword text + row count), poll every 200ms until hash changes or `pagination_settle_timeout_ms` (default 10000) → `PAGINATION_FAILED`.
- Also verify the highlighted/current page number incremented; if Etsy uses URL params for page, prefer reading them as confirmation, never as navigation (no direct URL loads — would re-render SPA unpredictably).
- Per-page checkpoint (§23) BEFORE navigating next.
- To return to page 1 (start of dry-run/disable): click page "1" button if present, else click prev until disabled.

## 23. Job State Persistence and Resume

```js
// snapshot.job (or import session .job for dry-run/disable)
{
  job_id: "uuid", type: "export|dry_run|disable",
  started_at: "ISO", updated_at: "ISO",
  current_page: 17, pages_total: 48,
  processed_keys: ["…"],          // for disable: keys already toggled+verified
  status: "running|paused|aborted|failed|done",
  last_error: null
}
```
- Checkpoint after every page (export) / every keyword action (disable).
- On content-script (re)injection, if a `running` job is found for this listing with `updated_at` older than 30s → mark `paused`, popup offers **Resume**.
- Resume for export: navigate to `current_page` via numbered buttons/next-clicks, continue. Rows already collected are kept (dedupe by key).
- Resume for disable: skip `processed_keys`.
- Tab closed mid-export → data up to last checkpoint survives; `complete:false` snapshots are clearly labeled and CAN be exported to ZIP with a warning banner.

## 24. Stale Export Warning

If `now - exported_at > 7 days` (constant `STALE_EXPORT_DAYS = 7`): yellow warning on Import/Preview ("Snapshot is N days old — stats and keyword set may have changed; re-export recommended"), and Dry Run becomes mandatory (it already is) with stale flag recorded in the operation log. Import is not blocked.

## 25. Image Handling

- Find product thumbnail (selector in `domSelectors.js`; observed: listing thumbnail image near the title, hosted on `i.etsystatic.com`).
- SW attempts `fetch(imageUrl)` → blob → include in ZIP as `product_image.{ext}` (ext from Content-Type, default `.jpg`).
- On any failure (CORS, 4xx, timeout 8s): write `image_url.txt` containing the URL into the ZIP instead. Log `IMAGE_FETCH_FAILED` as a warning, never fail the export.
- Do NOT store base64 image data inside `keywords_data.json` or in `chrome.storage.local` (only the URL string).

## 26. Preview Screen Behavior

- Groups (collapsible): `DISABLE_IRRELEVANT`, `DISABLE_BROAD`, `DISABLE_NO_CONVERSION`, `zero-spend disables` (§21), `REVIEW` (read-only), `KEEP` (read-only, collapsed), `Unmatched AI keywords` (read-only).
- Each actionable row: checkbox (default checked except zero-spend group), keyword, spend, clicks, views, ROAS, AI reason, `currently_enabled` state. Already-disabled keywords shown greyed with "already off" badge and unchecked+locked.
- Header: total selected count, total spend represented, button **Run Dry Run** (primary), **Cancel import**.
- Selection state persists in the import session.
- Hard overrides (§21) applied and visibly annotated before user ever sees the list.

## 27. Dry Run Behavior

Read-only full crawl with the selected keyword set. Output report:
```
{ found: [...keys], not_found: [...keys], already_disabled: [...keys], state_unreadable: [...keys] }
```
- "Found" = row located AND toggle state readable AND currently enabled.
- NO clicks, NO DOM mutations. Banner during run: "Dry run in progress — do not interact with the page".
- Gate: Disable button enables only if `not_found` is empty OR user explicitly checks "proceed with found subset only (N of M)". `state_unreadable` keywords are always excluded from the run set.
- Dry-run result hash is bound to the import session; any change to selection invalidates it (back to `previewed` state).

## 28. Real Disable Algorithm

Preconditions enforced in code: gate state == `dry_run_ok` AND same selection hash AND user clicked confirm dialog ("This will turn off N keywords on Etsy. Continue?").

```
for each page in 1..pages_total:
  rows = extract current page rows
  for each row whose normalized keyword ∈ runSet and key ∉ processed_keys:
    toggle = toggleDriver.find(row)
    state  = toggleDriver.readState(toggle)
    if state == disabled: log SKIP_ALREADY_DISABLED; mark processed; continue
    if state == unreadable: log SKIP_UNREADABLE; continue          // never click blind
    toggleDriver.click(toggle)                                      // real user-like click: pointerdown/up + click
    await verify: poll readState every 150ms up to toggle_verify_timeout_ms (default 5000)
      success → log DISABLED_OK {keyword, page, ts}; mark processed
      timeout → ONE retry (re-find toggle fresh from DOM); second failure → log TOGGLE_FAILED; continue (do not abort run)
    await sleep(settings.click_delay_ms + jitter(0–30%))
  checkpoint; pageGuards.checkThrottle(); await sleep(settings.page_delay_ms)
final report: {disabled_ok, skipped_already, failed, unreadable} → popup + oplog
```
Abort button: sets `status=aborted` flag in storage; loop checks it before every action; everything already done stays done and logged.

## 29. Rate Limiting

Settings-driven: `click_delay_ms` (default 1200), `page_delay_ms` (default 2500), both with ±30% random jitter. Exponential backoff: after a failed UI action, delay ×2 (cap 30s) until a success resets it.
**Throttle/captcha detection** (`pageGuards.checkThrottle()`): document contains captcha iframe (`src*="captcha"`, `hcaptcha`, `recaptcha`), or full-page interstitial keywords ("unusual traffic", "verify you are a human"), or 3 consecutive `PAGINATION_FAILED`/`TOGGLE_FAILED`. On detection: pause job (`status=paused`, `last_error=THROTTLE_DETECTED`), show popup error "Etsy may be rate-limiting. Wait a few minutes, then Resume.", never auto-resume.

## 30. Error Handling (canonical error codes)

`UNSUPPORTED_PAGE` (URL matches but table never appears AND no listing header), `NOT_LOGGED_IN` (sign-in form / redirect to login detected), `TABLE_NOT_FOUND` (timeout §10), `COLUMN_MAPPING_FAILED` (§11), `PAGINATION_FAILED` (§22), `IMAGE_FETCH_FAILED` (warning only, §25), `INVALID_AI_JSON` (§17), `LISTING_ID_MISMATCH` (§17), `STALE_EXPORT` (warning, §24), `KEYWORD_NOT_FOUND` (dry run/disable), `TOGGLE_FAILED` (§28), `TOGGLE_STATE_UNREADABLE`, `THROTTLE_DETECTED` (§29), `JOB_INTERRUPTED` (resume available).
Every error: `{code, message_user (plain English), message_debug (selector/DOM detail), ts, context{listing_id, page, keyword?}}` → operation log + popup display. Errors never silently swallowed; warnings never block.

## 31. Operation Log Schema

```js
// storage key "oplog": newest-first array, ring buffer (settings.log_max_entries, default 2000)
{ ts: "ISO", job_id, listing_id, level: "info|warn|error",
  event: "EXPORT_STARTED|EXPORT_PAGE_DONE|EXPORT_DONE|ZIP_BUILT|IMPORT_VALIDATED|PREVIEW_CONFIRMED|DRYRUN_STARTED|DRYRUN_DONE|DISABLE_STARTED|DISABLED_OK|SKIP_ALREADY_DISABLED|TOGGLE_FAILED|JOB_PAUSED|JOB_RESUMED|JOB_ABORTED|<error codes §30>",
  keyword: "normalized|null", page: 17|null, detail: {selector_used, retries, ...} }
```
Exportable as JSON from the Log tab.

## 32. Future Rollback / Re-enable Support (schema only)

Every `DISABLED_OK` entry contains enough data to re-enable later: `{keyword_normalized, listing_id, previous_state:"enabled", disabled_at}`. Additionally maintain `disabled_registry:${listing_id}` = array of such records, appended on every successful disable. No re-enable UI/automation in v1.

## 33. Settings Schema

```json
{ "schema_version": 1,
  "target_min_roas": 2.0, "break_even_roas": 1.25,
  "max_spend_without_order": 5.0, "min_clicks_for_decision": 8,
  "click_delay_ms": 1200, "page_delay_ms": 2500,
  "toggle_verify_timeout_ms": 5000, "pagination_settle_timeout_ms": 10000,
  "table_wait_timeout_ms": 20000, "stale_export_days": 7, "log_max_entries": 2000 }
```
All editable in Settings tab with min/max validation (delays: min 500ms click / 1000ms page — cannot be set lower).

## 34. Acceptance Criteria

1. On a real listing-stats page with 700+ keywords / 48 pages, Export completes, snapshot `complete:true`, `keywords.length == expected_keyword_count` (±collisions, which are logged).
2. ZIP downloads containing valid `keywords_data.json`, `README.txt` with AI prompt, and image or `image_url.txt`.
3. `women&#39;s 4th of july shirt` and `women's 4th of july shirt` normalize identically; `womens ...` stays distinct (unit-tested).
4. Importing `ai_results.json` with a wrong `listing_id` is fully blocked; with 2 unknown classifications, both coerce to REVIEW and are flagged.
5. Dry Run on the real page reports found/not_found/already_disabled with zero DOM mutations (verify: toggle states identical before/after).
6. Disable run on a 3-keyword test selection: all 3 toggles flip, each verified and logged; re-running the same import skips them as already disabled.
7. Killing the tab mid-export at page 20/48, reopening, and pressing Resume produces a complete snapshot without duplicate keys.
8. Setting click_delay to 500ms floor is enforced; throttle simulation (manually inject a fake captcha div) pauses the job within one action.
9. All jest tests pass; `tableExtractor` tests run against `fixtures/listing-stats-page.html`.
10. Unknown/invalid classification can never reach the disable run set (test).

## 35. Suggested Implementation Order

1. `normalize.js` + tests (foundation for identity).
2. `schemas.js` (export/AI/settings/log) + validators + tests.
3. `domSelectors.js` skeleton with documented placeholders + `tableExtractor.js` + jsdom tests against fixture (use placeholder fixture until real one provided — see README note).
4. Manifest + content script shell + pageGuards + popup shell with Export tab; PAGE_STATUS round-trip working.
5. Export crawl: paginator + checkpointing + resume; SW persistence.
6. ZIP build + download + image handling + README prompt generation.
7. Import + validation + matching + product profile editor.
8. Preview UI + safety overrides (§21).
9. Dry Run.
10. toggleDriver + real Disable + rate limiting + throttle detection.
11. Log tab, Settings tab, polish, full manual test checklist run.

After writing code for each step, run the tests before moving on. If Etsy DOM selectors are uncertain, keep them isolated in `domSelectors.js` with TODO markers and fallback chains so they can be patched from a real fixture without touching logic.

## 36. Manual Test Checklist

- [ ] Open a non-Etsy page → popup says "unsupported page".
- [ ] Open Etsy Ads listing page logged out → NOT_LOGGED_IN.
- [ ] Export on a small listing (1 page) and on the 48-page listing; verify counts vs the "(N)" header number.
- [ ] Verify ZIP contents open correctly; JSON validates against §15.
- [ ] Feed README prompt + JSON to Claude/ChatGPT manually; import the result.
- [ ] Import: wrong listing_id file → blocked. Malformed JSON → readable error list.
- [ ] Preview: deselect some keywords; zero-spend group default-unchecked; contradiction downgrade visible.
- [ ] Dry Run: confirm zero toggles changed (manually inspect 5 keywords before/after).
- [ ] Disable 2–3 sacrificial keywords; verify on Etsy after reload they remain off; verify oplog entries.
- [ ] Abort mid-disable; resume; no double-clicking of already-processed keywords.
- [ ] Stale warning: temporarily set exported_at back 8 days in storage.
- [ ] Throttle: inject `<iframe src="x-captcha">` via console mid-run → job pauses.
- [ ] Popup closed and reopened mid-export shows live progress.
- [ ] chrome://extensions reload mid-job → Resume offered, completes correctly.
