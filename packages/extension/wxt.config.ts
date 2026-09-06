import { defineConfig } from "wxt";

// docs/08 — permissions, and the CSP loosening WebLLM's WASM runtime needs
// (recorded as docs/12 T8).
export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "WebAudit",
    description: "Local website auditing. Nothing leaves your machine.",
    permissions: ["activeTab", "sidePanel", "storage", "cookies", "scripting"],
    host_permissions: ["<all_urls>"],
    content_security_policy: {
      extension_pages: [
        "script-src 'self' 'wasm-unsafe-eval'",
        "object-src 'self'",
        "connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.hf.co https://raw.githubusercontent.com",
      ].join("; "),
    },
  },
});
