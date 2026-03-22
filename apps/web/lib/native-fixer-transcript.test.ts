import { describe, expect, it } from "vitest";
import { formatTranscriptForDisplay } from "./native-fixer-transcript";

describe("formatTranscriptForDisplay", () => {
  it("merges fragmented short lines into one paragraph", () => {
    const input = ["Not.", "Right.", "Huge.", "Hello.", "Good.", "Wow.", "You,", "oh,", "He?"].join("\n");

    expect(formatTranscriptForDisplay(input)).toBe("Not. Right. Huge. Hello. Good. Wow. You, oh, He?");
  });

  it("keeps paragraph boundaries from empty lines", () => {
    const input = ["I was late.", "Because of traffic.", "", "Then I joined the meeting."].join("\n");

    expect(formatTranscriptForDisplay(input)).toBe("I was late. Because of traffic.\n\nThen I joined the meeting.");
  });

  it("keeps natural transcript mostly as-is when not fragmented", () => {
    const input = "I had a productive morning.\nI reviewed our plan and sent updates to the team.";

    expect(formatTranscriptForDisplay(input)).toBe(input);
  });
});
