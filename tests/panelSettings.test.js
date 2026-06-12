/**
 * Regression harness for the panel UI running under jsdom with a mocked
 * chrome.storage. Reproduces real user flows (toggle the Spend>0 checkbox)
 * and asserts the persisted settings actually change.
 */
const { test, before } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

function makeChromeMock() {
  const store = {};
  return {
    _store: store,
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: store[key] };
          const out = {};
          for (const k of key) out[k] = store[k];
          return out;
        },
        async set(obj) {
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
        },
        async remove(key) {
          delete store[key];
        },
      },
    },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
  };
}

let panelUi, storageKeys, chromeMock;

before(async () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://www.etsy.com/your/shops/me/advertising/listings/123",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.navigator = dom.window.navigator;
  chromeMock = makeChromeMock();
  global.chrome = chromeMock;

  // Load UMD modules in manifest order so globalThis.EAKM is populated
  // before panelUi captures it.
  require("../src/shared/normalize.js");
  require("../src/shared/storageKeys.js");
  require("../src/shared/classification.js");
  require("../src/shared/schemas.js");
  require("../src/shared/csv.js");
  require("../src/shared/logger.js");
  require("../src/content/domSelectors.js");
  require("../src/content/pageGuards.js");
  require("../src/content/tableExtractor.js");
  require("../src/content/paginator.js");
  require("../src/content/toggleDriver.js");
  require("../src/content/jobs.js");
  require("../src/content/panelUi.js");
  storageKeys = globalThis.EAKM.storageKeys;
  panelUi = globalThis.EAKM.panelUi;
});

const settle = () => new Promise((r) => setTimeout(r, 50));

function shadow() {
  return document.getElementById("eakm-panel-host").shadowRoot;
}

test("panel mounts with Export tab and the Spend>0 checkbox checked by default", async () => {
  await panelUi.mount("123");
  await settle();
  const cb = shadow().querySelector("#spendOnly");
  assert.ok(cb, "checkbox rendered");
  assert.strictEqual(cb.checked, true);
});

test("unchecking the Spend>0 checkbox persists only_spend_gt_zero=false", async () => {
  const cb = shadow().querySelector("#spendOnly");
  cb.click(); // user unchecks
  await settle();
  const stored = chromeMock._store[storageKeys.KEYS.settings];
  assert.ok(stored, "settings object written to storage");
  assert.strictEqual(stored.only_spend_gt_zero, false);
});

test("re-render after toggle shows the persisted (unchecked) state", async () => {
  await panelUi.render();
  await settle();
  const cb = shadow().querySelector("#spendOnly");
  assert.strictEqual(cb.checked, false);
});

test("checking it back persists true again", async () => {
  const cb = shadow().querySelector("#spendOnly");
  cb.click();
  await settle();
  assert.strictEqual(chromeMock._store[storageKeys.KEYS.settings].only_spend_gt_zero, true);
});

test("paste-import flow creates an import session and opens Preview", async () => {
  // Seed a snapshot the import will match against.
  chromeMock._store["snapshot:123"] = {
    schema_version: 1,
    listing_id: "123",
    listing_title: "Cat Biting Shirt",
    exported_at: new Date().toISOString(),
    complete: true,
    keywords: [
      { keyword_normalized: "cat bite shirt", key: "123::cat bite shirt", spend: 0.15, clicks: 1, views: 5, currently_enabled: true },
      { keyword_normalized: "anime", key: "123::anime", spend: 0, clicks: 0, views: 8, currently_enabled: true },
    ],
  };
  await panelUi.render();
  await settle();
  const importTabBtn = [...shadow().querySelectorAll(".tabs button")].find((b) => b.textContent === "Import");
  importTabBtn.click();
  await settle();

  const box = shadow().querySelector("#aiPasteBox");
  assert.ok(box, "paste box rendered");
  box.value = '```json\n' + JSON.stringify({
    schema_version: 1,
    listing_id: "123",
    results: [
      { keyword: "cat bite shirt", classification: "KEEP" },
      { keyword: "anime", classification: "DISABLE_BROAD", reason: "too broad" },
    ],
  }) + '\n```';
  shadow().querySelector("#aiPasteImport").click();
  await settle();

  const session = chromeMock._store["import:123"];
  assert.ok(session, "import session stored");
  assert.strictEqual(session.match.matched.length, 2);
  // "anime" is actionable but zero-spend → default-unchecked, so selection is empty;
  // gate must be at least 'imported' (auto-switch to Preview may bump it to 'previewed').
  assert.ok(["imported", "previewed"].includes(session.gate));
  const activeTab = shadow().querySelector(".tabs button.active");
  assert.strictEqual(activeTab.textContent, "Preview");
});
