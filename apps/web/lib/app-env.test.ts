import { describe, expect, it } from "vitest";
import { normalizeQueueNameEnv } from "./app-env";

describe("normalizeQueueNameEnv", () => {
  it("removes escaped trailing newline from Vercel-style values", () => {
    expect(normalizeQueueNameEnv("reading-generate\\n")).toBe("reading-generate");
  });

  it("removes actual trailing newline and surrounding whitespace", () => {
    expect(normalizeQueueNameEnv("  reading-generate\n  ")).toBe("reading-generate");
  });

  it("keeps only first logical line when accidental multiline value is provided", () => {
    expect(normalizeQueueNameEnv("reading-generate\nextra")).toBe("reading-generate");
  });
});
