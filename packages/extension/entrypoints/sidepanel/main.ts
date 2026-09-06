/**
 * The side panel is the compute host (docs/01): it assembles `Capabilities`,
 * calls `core.audit()`, and owns the WebLLM engine. For now it only proves that
 * `core` imports and runs in an extension document.
 */
import { VERSION } from "core";

console.info(`webaudit: core ${VERSION}`);
