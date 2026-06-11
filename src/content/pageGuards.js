/**
 * Page-level guards: supported-page check, logged-in check, throttle/captcha
 * detection. SPEC §29–§30.
 */
(function (root, factory) {
  const mod = factory(
    (root.EAKM && root.EAKM.domSelectors) ||
      (typeof require === "function" ? require("./domSelectors.js") : null)
  );
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = mod;
  }
  root.EAKM = root.EAKM || {};
  root.EAKM.pageGuards = mod;
})(globalThis, function (domSelectors) {
  "use strict";

  const LISTING_URL_RE = /\/your\/shops\/me\/advertising\/listings\/(\d+)/;

  /** Extract listing id from a URL, or null. */
  function listingIdFromUrl(url) {
    const m = String(url || "").match(LISTING_URL_RE);
    return m ? m[1] : null;
  }

  /** True when the current document looks like a logged-out state. */
  function looksLoggedOut(doc) {
    const d = doc || document;
    if (/\/signin|\/sso\//.test(d.location ? d.location.pathname : "")) return true;
    const hit = domSelectors.resolve("signinForm", d);
    // The signin link fallback alone is weak; require a form/input match.
    return Boolean(hit && hit.index <= 0);
  }

  const THROTTLE_TEXT_RE = /unusual traffic|verify you are a human|are you a robot/i;

  /**
   * Throttle / captcha detection (SPEC §29). consecutiveFailures is the
   * caller-maintained count of PAGINATION_FAILED/TOGGLE_FAILED in a row.
   */
  function checkThrottle(doc, consecutiveFailures) {
    const d = doc || document;
    const captcha = d.querySelector(domSelectors.SELECTORS.captchaFrame.primary);
    if (captcha) return { throttled: true, reason: "captcha-iframe" };
    const bodyText = d.body ? d.body.textContent || "" : "";
    if (THROTTLE_TEXT_RE.test(bodyText.slice(0, 20000))) {
      return { throttled: true, reason: "interstitial-text" };
    }
    if ((consecutiveFailures || 0) >= 3) {
      return { throttled: true, reason: "consecutive-failures" };
    }
    return { throttled: false, reason: null };
  }

  /** Full page status for PAGE_STATUS reporting. */
  function pageStatus(doc, url) {
    const d = doc || document;
    const u = url || (d.location ? d.location.href : "");
    const listingId = listingIdFromUrl(u);
    return {
      supported: Boolean(listingId),
      listingId,
      loggedIn: !looksLoggedOut(d),
    };
  }

  return { LISTING_URL_RE, listingIdFromUrl, looksLoggedOut, checkThrottle, pageStatus };
});
