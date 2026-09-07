import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * The engine runs in a Web Worker so prefill does not block the document
 * (docs/08). The spike measures it here rather than on the main thread,
 * because that is where it will actually live — and because whether
 * `interruptGenerate()` survives the worker boundary is one of the questions
 * S2 exists to answer.
 */
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
