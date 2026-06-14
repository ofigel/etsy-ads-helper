# Changelog

All notable changes to **Etsy Ads Keyword Manager** are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/),
and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.7] — 2026-06-12

### Added
- **Paste-JSON import.** The Import tab now accepts the AI's answer pasted
  directly into a textarea (markdown ```code fences``` are stripped
  automatically) in addition to the file picker.
- Successful import auto-switches to the **Preview** tab.
- Brand icon: the panel header and the collapsed bubble now use the
  cat-biting-hand SVG in brand orange.

## [0.1.6] — 2026-06-12

### Fixed
- Settings handlers read the DOM event **before** any `await`, so the
  "Collect only keywords with Spend > 0" checkbox (and every Settings number
  field) actually persists. Previously the handler threw after the await and
  the stored value never changed.

## [0.1.5] — 2026-06-12

### Fixed
- Selectors aligned with a **real captured Etsy DOM** (June 2026):
  per-cell column labels live in `.wt-table--responsive__title` (CSS-hidden on
  desktop) and the keyword text sits in a `WtInlineToggle` truncation
  component — both now read cleanly.
- Product image: the thumbnail selector now requires a real listing photo
  (`WtImage` / `/il/` path) instead of grabbing a site-asset SVG icon; the URL
  is upgraded to `il_1000x1000` for the AI, and the service worker rejects
  svg/empty bodies (falls back to `image_url.txt`).
- New authoritative fixture `fixtures/real-table-fragment.html` with tests for
  extraction, toggles, pagination and the Spend sort control.

## [0.1.4] — 2026-06-12

### Fixed
- Strip the glued column-label prefix from keyword cells
  (`Targeted keywordjapan` → `japan`), applied identically in the extractor
  and the toggle driver so disable runs match exported identities.
- Listing title: keep `Related tags for {title}` blocks but strip the prefix
  to recover the real product title.

## [0.1.3] — 2026-06-11

### Fixed
- Tolerate hidden per-cell labels and prefixed numbers: cell reading goes
  through `visibleText()` (skips `aria-hidden` / screen-reader-only nodes) and
  numeric parsers extract the first numeric token from arbitrary text. Fixes
  exports that collected 0 keywords on every page.

## [0.1.2] — 2026-06-11

### Added
- Parse-health diagnostics in the operation log (rows seen/kept + raw vs
  parsed Spend sample) and a **Copy diagnostics** button on the Export tab.
- A zero-keyword export now shows a warning instead of a green success.

## [0.1.1] — 2026-06-11

### Fixed
- Spend sort made resilient and **non-fatal**: tries every clickable
  candidate in the Spend header, verifies via `aria-sort` then row
  comparison, and falls back to a full crawl (still filtering Spend > 0) when
  sorting can't be confirmed — instead of aborting the export.
- Listing title read from the listing link rather than the dashboard `h1`.

## [0.1.0] — 2026-06-11

### Added
- Initial MVP. Manifest V3 Chrome extension, no runtime dependencies.
- Floating, collapsible on-page panel shown only on Etsy Ads listing-stats
  pages (Shadow DOM, brand-orange styling).
- **Export**: paginated keyword crawl with delays + jitter, per-page
  checkpointing and resume; optional "Spend > 0 only" mode with sort-by-spend
  and early stop.
- **ZIP for AI**: `keywords_data.json` + `keywords.csv` + `README.txt` prompt
  + product image; bundled dependency-free ZIP writer.
- **Import / Preview / Dry Run / Disable** pipeline with state gates
  (`imported → previewed → dry_run_ok → executing → done`), safety overrides
  (zero-spend group, contradiction downgrade), rate limiting, throttle/captcha
  detection, and a full operation log.
- Keyword identity = `listing_id::normalized_keyword` (HTML entities decoded,
  apostrophes preserved). All Etsy selectors isolated in `domSelectors.js`
  with fallback chains and an "update the extension" banner on DOM drift.
- Unit tests via `node --test` + jsdom.

[0.1.7]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.7
[0.1.6]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.6
[0.1.5]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.5
[0.1.4]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.4
[0.1.3]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.3
[0.1.2]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.2
[0.1.1]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.1
[0.1.0]: https://github.com/ofigel/etsy-ads-helper/releases/tag/v0.1.0
