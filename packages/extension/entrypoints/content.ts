/**
 * Builds a `PageSnapshot` from the DOM using core's pure builder, on request
 * only — never on every page (docs/08). The builder itself lands in M1 and the
 * message handling in M2.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // Intentionally empty until M2.
  },
});
