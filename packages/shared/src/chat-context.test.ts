import { describe, expect, it } from "vitest";
import { buildAskContextTurns } from "./chat-context";

describe("buildAskContextTurns", () => {
  it("keeps 5 history turns plus latest message", () => {
    const rows = Array.from({ length: 12 }).map((_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `m${index + 1}`
    }));

    const turns = buildAskContextTurns({
      rows,
      latestMessage: "latest",
      maxHistoryTurns: 5,
      maxTotalChars: 10_000
    });

    expect(turns).toHaveLength(11);
    expect(turns[0]?.text).toBe("m3");
    expect(turns[10]?.text).toBe("latest");
  });

  it("does not drop message count even when each message is long", () => {
    const long = "x".repeat(1200);
    const rows = Array.from({ length: 10 }).map((_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${long}${index}`
    }));

    const turns = buildAskContextTurns({
      rows,
      latestMessage: `${long}latest`,
      maxHistoryTurns: 5,
      maxTotalChars: 3000
    });

    expect(turns).toHaveLength(11);
    for (const turn of turns) {
      expect(turn.text.length).toBeLessThanOrEqual(Math.floor(3000 / 11));
    }
  });
});
