/**
 * The only privileged context (docs/07). It holds `chrome.cookies`, the host
 * permissions, and the cross-origin fetch — and it holds nothing else. No
 * analysis logic lives here; it stays thin and short-lived so that the
 * privilege it carries has as little code around it as possible.
 *
 * Cookie flags, the domain-allowlist check, and message routing land in M2.
 */
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error("webaudit: could not set side panel behaviour", error);
    });
});
