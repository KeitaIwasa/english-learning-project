import { describe, expect, it } from "vitest";
import { buildLearningProfile, calcCoverage, chooseTargets } from "./learning";

describe("buildLearningProfile", () => {
  it("prioritizes due cards and keeps top grammar signals", () => {
    const today = "2026-02-21T00:00:00.000Z";

    const profile = buildLearningProfile(
      [
        {
          en: "I have been studying English.",
          nextReviewAt: "2026-02-20T00:00:00.000Z",
          wrongRate7d: 0.1,
          createdAt: "2026-02-10T00:00:00.000Z"
        },
        {
          en: "She is interested in music.",
          nextReviewAt: null,
          wrongRate7d: 0.5,
          createdAt: "2026-02-20T00:00:00.000Z"
        }
      ],
      [
        { signalKey: "present perfect", weight: 0.9 },
        { signalKey: "prepositions", weight: 0.8 },
        { signalKey: "articles", weight: 0.7 },
        { signalKey: "plural nouns", weight: 0.1 }
      ],
      today
    );

    expect(profile.reviewTargets).toContain("I have been studying English.");
    expect(profile.reviewTargets).toContain("She is interested in music.");
    expect(profile.grammarTargets).toEqual([
      "present perfect",
      "prepositions",
      "articles"
    ]);
  });
});

describe("chooseTargets", () => {
  it("respects 70/30 split approximation", () => {
    const result = chooseTargets({
      reviewTargets: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      grammarTargets: [],
      newCandidates: ["n1", "n2", "n3", "n4", "n5"]
    });

    expect(result.review.length).toBe(7);
    expect(result.fresh.length).toBe(3);
  });
});

describe("calcCoverage", () => {
  it("calculates match ratio by normalized string", () => {
    const score = calcCoverage(["Present Perfect", "in charge of"], ["present perfect", "IN CHARGE OF"]);
    expect(score).toBe(1);
  });
});
