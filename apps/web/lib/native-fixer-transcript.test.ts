import { describe, expect, it } from "vitest";
import { buildTranscriptCopyText, formatTranscriptForDisplay, getTranscriptSpeakerLabel } from "./native-fixer-transcript";

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

  it("returns speaker labels for transcript turns", () => {
    expect(getTranscriptSpeakerLabel(1)).toBe("Speaker 1");
    expect(getTranscriptSpeakerLabel(2)).toBe("Speaker 2");
    expect(getTranscriptSpeakerLabel("unknown")).toBe("不明話者");
  });

  it("builds copy text from transcript turns", () => {
    expect(
      buildTranscriptCopyText({
        transcriptFull: "ignored",
        transcriptTurns: [
          { speaker: 1, text: "Hello there." },
          { speaker: 2, text: "Hi." }
        ]
      })
    ).toBe("Speaker 1: Hello there.\n\nSpeaker 2: Hi.");
  });

  it("falls back to formatted transcript when turns are absent", () => {
    expect(
      buildTranscriptCopyText({
        transcriptFull: ["Not.", "Right.", "Huge."].join("\n"),
        transcriptTurns: []
      })
    ).toBe("Not. Right. Huge.");
  });
});
