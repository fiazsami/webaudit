import { defineConfig } from "wxt";

// docs/08 — permissions, and the CSP loosening WebLLM's WASM runtime needs
// (recorded as docs/12 T8).
export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "WebAudit",
    description: "Local website auditing. Nothing leaves your machine.",
    // Gives the extension a toolbar button; setPanelBehavior needs one to open
    // the side panel from.
    action: { default_title: "Audit this page" },
    permissions: ["activeTab", "sidePanel", "storage", "cookies", "scripting"],
    host_permissions: ["<all_urls>"],
    // Chrome refuses automated navigation to an extension page, so the S2 and
    // evals drivers cannot open their harnesses without this. Gated on an env
    // flag and absent from every normal build: a page reachable by any website
    // is not something to ship for the sake of a measurement script.
    ...(process.env["WEBAUDIT_SPIKE"] === "1"
      ? {
          web_accessible_resources: [
            { resources: ["spike-s2.html", "evals.html"], matches: ["<all_urls>"] },
          ],
        }
      : {}),
    content_security_policy: {
      extension_pages: [
        "script-src 'self' 'wasm-unsafe-eval'",
        "object-src 'self'",
        // Spike S2 found the original list wrong, in two ways. HuggingFace now
        // serves weights through its Xet backend on regional hosts such as
        // us.aws.cdn.hf.co, which no enumeration of cdn-lfs hostnames covers —
        // hence the wildcards. And the compiled model library is a .wasm fetched
        // from raw.githubusercontent.com, not from HuggingFace at all, so a run
        // touches two origins rather than one (docs/12 T7).
        "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
      ].join("; "),
    },
  },
});
