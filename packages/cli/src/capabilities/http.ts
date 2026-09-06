import type { Http, HttpRequestInit, HttpResponse } from "core";

/**
 * The Node host's network capability (docs/01).
 *
 * Plain `fetch`. It has none of the extension's privileges: no host
 * permissions, so CORS applies and some response headers are hidden. That is
 * exactly why header analysis is the extension's job (docs/03) — this exists so
 * the CLI can fetch policy pages and replay recorded runs.
 */
export function createNodeHttp(): Http {
  return {
    async fetch(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
      const controller = new AbortController();
      const timeout =
        init.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              controller.abort();
            }, init.timeoutMs);

      // Honour a caller's signal as well as our own timeout.
      init.signal?.addEventListener("abort", () => {
        controller.abort();
      });

      try {
        // Built conditionally: exactOptionalPropertyTypes means an explicit
        // `undefined` is not the same as an absent property.
        const response = await globalThis.fetch(url, {
          method: init.method ?? "GET",
          redirect: init.redirect ?? "follow",
          signal: controller.signal,
          ...(init.headers === undefined ? {} : { headers: init.headers }),
          ...(init.body === undefined ? {} : { body: init.body }),
        });

        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });

        return {
          url: response.url,
          status: response.status,
          headers,
          body: await response.text(),
        };
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
