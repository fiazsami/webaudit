import { describe, expect, it } from "vitest";

import { MessageError, parseReply, parseRequest } from "../messaging.js";

function raw(type: string, payload: unknown, id = "m1"): unknown {
  return { id, type, payload };
}

describe("parseRequest", () => {
  it("accepts a well-formed request", () => {
    const { id, request } = parseRequest(
      raw("cookies.get", { url: "https://a.example/" }),
    );
    expect(id).toBe("m1");
    expect(request.type).toBe("cookies.get");
  });

  it("applies schema defaults", () => {
    const { request } = parseRequest(
      raw("http.fetch", { url: "https://a.example/", auditId: "x" }),
    );
    expect(request).toMatchObject({ payload: { method: "GET" } });
  });

  it("gives a fetch request no way to state its own permissions", () => {
    const { request } = parseRequest(
      raw("http.fetch", {
        url: "https://attacker.example/",
        auditId: "x",
        allowedDomains: ["attacker.example"],
      }),
    );
    // zod strips the unknown key: a caller cannot authorise itself (docs/12 T2).
    expect(request.payload).not.toHaveProperty("allowedDomains");
  });

  it("rejects a message that is not an envelope", () => {
    expect(() => parseRequest({ nope: true })).toThrow(MessageError);
    expect(() => parseRequest("a string")).toThrow(/valid envelope/);
    expect(() => parseRequest(null)).toThrow(MessageError);
  });

  it("rejects an unknown message type rather than defaulting it", () => {
    expect(() => parseRequest(raw("shell.exec", { cmd: "rm -rf /" }))).toThrow(
      /unrecognised message/,
    );
  });

  it("rejects a known type carrying the wrong payload", () => {
    expect(() => parseRequest(raw("http.fetch", { url: "not-a-url" }))).toThrow(
      MessageError,
    );
    expect(() =>
      parseRequest(raw("snapshot.capture", { tabId: "one", auditId: "a" })),
    ).toThrow(MessageError);
  });

  it("reports invalid-message so the sender learns nothing else", () => {
    try {
      parseRequest(raw("shell.exec", {}));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MessageError);
      expect((error as MessageError).code).toBe("invalid-message");
    }
  });
});

describe("parseReply", () => {
  it("carries replyTo back to the caller", () => {
    const { replyTo, reply } = parseReply({
      id: "m2",
      replyTo: "m1",
      type: "error",
      payload: { code: "domain-not-allowed", message: "no" },
    });
    expect(replyTo).toBe("m1");
    expect(reply.type).toBe("error");
  });

  it("rejects an error code that is not in the table", () => {
    expect(() =>
      parseReply({
        id: "m2",
        replyTo: "m1",
        type: "error",
        payload: { code: "made-up", message: "no" },
      }),
    ).toThrow(MessageError);
  });
});
