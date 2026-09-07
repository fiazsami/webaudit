import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * The engine's worker (docs/08). Nothing but the handler lives here; the worker
 * exists so prefill does not block the side panel's UI thread.
 */
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
