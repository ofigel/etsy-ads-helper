/**
 * Content script entry: page detection, panel lifecycle, SPA navigation
 * tracking, message handling. SPEC §6.
 */
/* global EAKM */
(function () {
  "use strict";

  let currentListingId = null;

  async function syncWithPage() {
    const status = EAKM.pageGuards.pageStatus(document, location.href);
    if (!status.supported) {
      if (currentListingId) {
        EAKM.panelUi.unmount();
        currentListingId = null;
      }
      return;
    }
    if (status.listingId === currentListingId) return;

    currentListingId = status.listingId;
    if (!status.loggedIn) {
      await EAKM.logger.log({
        listing_id: status.listingId,
        level: "error",
        event: "NOT_LOGGED_IN",
        detail: {},
      });
    }
    const stale = await EAKM.jobs.recoverStaleJobs(status.listingId);
    await EAKM.panelUi.mount(status.listingId);
    if (stale.export || stale.import) {
      // Panel reads job state from storage on render and offers Resume.
      EAKM.panelUi.render();
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "TOGGLE_PANEL") {
      EAKM.panelUi.toggleCollapsed();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "GET_PAGE_STATUS") {
      sendResponse(EAKM.pageGuards.pageStatus(document, location.href));
      return false;
    }
    return false;
  });

  // Etsy's seller dashboard is an SPA: watch for URL changes.
  let lastHref = null;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      syncWithPage();
    }
  }, 800);

  syncWithPage();
})();
