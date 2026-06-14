# Etsy Ads Keyword Manager — Chrome Extension

A Manifest V3 Chrome extension for Etsy sellers that turns the manual "clean up
Etsy Ads targeted keywords" routine into a safe, semi-automated workflow:

1. **Export** all targeted keywords (with stats) from an Etsy Ads listing-stats
   page — optionally only those with **Spend > 0** (the table is sorted by
   Spend descending and the crawl stops at the first all-zero page).
2. **Download a ZIP** with `keywords_data.json`, `keywords.csv`, a ready-made
   AI prompt (`README.txt`) and the product image — feed it to ChatGPT/Claude
   manually. The prompt asks the AI to judge relevance from the *product
   image and theme* (including POD blank brands like Comfort Colors 1717 /
   Gildan 5000), not just click statistics.
3. **Import** the AI's `ai_results.json` back, **preview** the proposed
   disables with safety overrides, run a mandatory **Dry Run**, then let the
   extension **disable** the selected keywords one by one with human-like
   delays and full operation logging.

The UI is a floating, collapsible panel shown **only** on
`https://www.etsy.com/your/shops/me/advertising/listings/<id>` pages
(plus the toolbar icon, which toggles the panel).

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this repository folder.
3. Open an Etsy Ads listing-stats page; the orange panel appears bottom-right.

No build step — plain JS, no third-party runtime dependencies (the ZIP writer
is bundled, ~100 lines, STORE method).

## Workflow

| Step | Tab | What happens |
|------|-----|--------------|
| Export | **Export** | Crawls all table pages with delays + jitter, checkpoints after every page (tab crash → Resume). |
| Analyze | — | Upload the ZIP contents to your AI of choice; save its JSON answer as `ai_results.json`. |
| Import | **Import** | Validates the file (wrong listing → hard block; unknown classes → coerced to REVIEW). Product profile editor lives here too. |
| Preview | **Preview** | Grouped proposed changes. Zero-spend disables are separated and unchecked by default; contradictions are downgraded. |
| Dry Run | **Preview → Run** | Read-only crawl verifying every selected keyword exists and is enabled. No clicks. |
| Disable | **Run** | Only after a green dry run for the same selection + explicit confirm. Each toggle is clicked, verified, logged; abort/resume supported. |

## Safety model

- Only `DISABLE_BROAD` / `DISABLE_IRRELEVANT` / `DISABLE_NO_CONVERSION` are
  actionable; `KEEP`/`REVIEW`/anything unknown is never acted on.
- State gates: `imported → previewed → dry_run_ok → executing → done`; any
  selection change invalidates the dry run.
- Rate limiting: configurable click/page delays (hard floors 500/1000 ms)
  with ±30% jitter, exponential backoff, captcha/throttle detection that
  pauses the job and never auto-resumes.
- Keyword identity = `listing_id::normalized_keyword` (HTML entities decoded,
  apostrophes preserved — `women's` ≠ `womens`). No synthetic IDs.

## When Etsy changes its markup

All DOM selectors live in `src/content/domSelectors.js` only. On
`TABLE_NOT_FOUND` / `COLUMN_MAPPING_FAILED` / `SORT_FAILED` /
`PAGINATION_FAILED` the panel shows a persistent banner asking the user to
update the extension; patch that one file against a fresh DOM capture.

`fixtures/listing-stats-page.html` is currently a **synthetic** fixture
modeled on the June 2026 markup. To tighten the tests, replace it with a real
capture: DevTools → copy `outerHTML` of the rendered keywords-table section
(view-source is useless — the table is client-side rendered).

## Development

```bash
npm install        # jsdom for tests only
npm test           # node --test, 80 tests
```

Layout (per spec): `src/shared/*` pure logic (UMD, also `require()`-able from
tests), `src/content/*` page automation + panel UI, `src/background/*`
service worker (ZIP build, downloads, image fetch).

The full implementation specification is in `SPEC.md`.

## Manual test checklist

See SPEC §36 — covers logged-out detection, partial exports + resume,
wrong-listing imports, dry-run immutability, sacrificial disables, abort,
stale-snapshot warning, simulated captcha and mid-job extension reloads.

## Community

More tools and tips for Etsy / print-on-demand sellers in the Telegram
channel: **[t.me/PODEtsy](https://t.me/PODEtsy)**

Built end-to-end with Claude Fable 5. Not affiliated with or endorsed by Etsy.
