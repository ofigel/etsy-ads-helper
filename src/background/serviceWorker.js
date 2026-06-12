/**
 * Background service worker: ZIP build + download, product image fetch,
 * toolbar-click → panel toggle. SPEC §7, §25.
 *
 * Classic (non-module) worker; shared code is loaded via importScripts and
 * attaches to globalThis.EAKM (UMD pattern).
 */
/* global EAKM */
importScripts(
  "zipBuilder.js",
  "../shared/storageKeys.js",
  "../shared/csv.js",
  "../shared/prompt.js"
);

const IMAGE_FETCH_TIMEOUT_MS = 8000;

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }).catch(() => {
      // Not an Etsy ads listing page — no content script there; ignore.
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  if (msg.type === "BUILD_ZIP") {
    buildAndDownloadZip(msg.listingId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  return false;
});

/** Fetch product image from Etsy CDN; null on any failure (SPEC §25). */
async function fetchProductImage(imageUrl) {
  if (!imageUrl || !/^https:\/\/i\.etsystatic\.com\//.test(imageUrl)) return null;
  // Site-asset icons/SVGs are not product photos — fall back to the URL file.
  if (/site-assets|\.svg(\?|$)/.test(imageUrl)) return null;
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(imageUrl, { signal: controller.signal });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "";
    const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    const ext = extMap[contentType.split(";")[0].trim()];
    if (!ext) return null; // svg/html/unknown → not a usable product photo
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (!bytes.length) return null;
    return { bytes, ext };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(killer);
  }
}

async function buildAndDownloadZip(listingId) {
  const KEYS = EAKM.storageKeys.KEYS;
  const stored = await chrome.storage.local.get([
    KEYS.snapshot(listingId),
    KEYS.productProfile(listingId),
  ]);
  const snapshot = stored[KEYS.snapshot(listingId)];
  if (!snapshot || !Array.isArray(snapshot.keywords) || !snapshot.keywords.length) {
    throw new Error("No snapshot to export — run Export first");
  }
  const profile = stored[KEYS.productProfile(listingId)] || defaultProfile(snapshot);
  const promptText = EAKM.prompt.buildAiPrompt(snapshot, profile);

  const exportJson = {
    schema_version: 1,
    tool: EAKM.storageKeys.TOOL_ID,
    listing_id: snapshot.listing_id,
    listing_title: snapshot.listing_title,
    exported_at: snapshot.exported_at,
    date_range_label: snapshot.date_range_label,
    complete: snapshot.complete,
    filter_spend_gt_zero: Boolean(snapshot.filter_spend_gt_zero),
    product_profile: profile,
    instructions_for_ai: promptText,
    totals: snapshot.totals,
    keywords: snapshot.keywords,
  };

  const files = [
    { name: "keywords_data.json", content: JSON.stringify(exportJson, null, 2) },
    { name: "keywords.csv", content: EAKM.csv.keywordsToCsv(snapshot.keywords) },
    { name: "README.txt", content: promptText },
  ];

  let imageIncluded = false;
  const image = await fetchProductImage(snapshot.image_url);
  if (image) {
    files.push({ name: "product_image." + image.ext, content: image.bytes });
    imageIncluded = true;
  } else if (snapshot.image_url) {
    files.push({ name: "image_url.txt", content: snapshot.image_url });
  }

  const zipBytes = EAKM.zipBuilder.buildZip(files);
  const dataUrl = "data:application/zip;base64," + bytesToBase64(zipBytes);
  const date = (snapshot.exported_at || new Date().toISOString()).slice(0, 10);
  const filename = `etsy-ads-keywords-${listingId}-${date}.zip`;
  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
  return { downloadId, filename, imageIncluded, files: files.map((f) => f.name) };
}

function defaultProfile(snapshot) {
  return {
    listing_id: snapshot.listing_id,
    title: snapshot.listing_title || "",
    product_type: "",
    niche: "",
    audience: "",
    relevant_themes: [],
    irrelevant_themes: [],
    notes: "",
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
