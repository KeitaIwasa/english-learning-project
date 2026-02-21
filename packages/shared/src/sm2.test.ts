import { describe, expect, it } from "vitest";
import { nextSm2 } from "../../../supabase/functions/_shared/sm2";

describe("nextSm2", () => {
  it("updates interval and repetition for remembered(quality=4)", () => {
    const result = nextSm2({ quality: 4, repetition: 1, intervalDays: 1, easeFactor: 2.5 });
    expect(result.repetition).toBe(2);
    expect(result.intervalDays).toBe(6);
    expect(result.easeFactor).toBeGreaterThan(2.4);
  });

  it("resets repetition for not remembered(quality=2)", () => {
    const result = nextSm2({ quality: 2, repetition: 4, intervalDays: 12, easeFactor: 2.5 });
    expect(result.repetition).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBe(2.3);
  });
});
