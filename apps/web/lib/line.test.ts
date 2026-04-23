import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLineLinkCode, parseLineLinkCode, verifyLineWebhookSignature } from "./line";

describe("parseLineLinkCode", () => {
  it("extracts a code from a valid link command", () => {
    expect(parseLineLinkCode("link ABCD1234")).toBe("ABCD1234");
    expect(parseLineLinkCode(" LINK abcd1234 ")).toBe("ABCD1234");
  });

  it("rejects unrelated messages", () => {
    expect(parseLineLinkCode("hello")).toBeNull();
    expect(parseLineLinkCode("link")).toBeNull();
    expect(parseLineLinkCode("link TOO-LONG-CODE")).toBeNull();
  });
});

describe("createLineLinkCode", () => {
  it("creates an 8-character uppercase code", () => {
    expect(createLineLinkCode()).toMatch(/^[A-Z0-9]{8}$/);
  });
});

describe("verifyLineWebhookSignature", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid signature", () => {
    vi.stubEnv("LINE_CHANNEL_SECRET", "test-secret");
    const body = JSON.stringify({ events: [] });
    const signature = createHmac("sha256", "test-secret").update(body).digest("base64");
    expect(
      verifyLineWebhookSignature({
        body,
        signature
      })
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    vi.stubEnv("LINE_CHANNEL_SECRET", "test-secret");
    expect(
      verifyLineWebhookSignature({
        body: JSON.stringify({ events: [] }),
        signature: "invalid"
      })
    ).toBe(false);
  });
});
