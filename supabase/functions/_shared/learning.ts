export type FlashcardStat = {
  id: string;
  en: string;
  nextReviewAt: string | null;
  wrongRate7d: number;
  createdAt: string;
};

export type LearningProfile = {
  reviewTargets: string[];
  grammarTargets: string[];
  newCandidates: string[];
};

export function buildLearningProfile(cards: FlashcardStat[], grammarSignals: string[], todayIso: string): LearningProfile {
  const today = new Date(todayIso);
  const due = cards.filter((card) => card.nextReviewAt && new Date(card.nextReviewAt) <= today).map((card) => card.en);

  const weak = cards
    .filter((card) => card.wrongRate7d >= 0.4)
    .sort((a, b) => b.wrongRate7d - a.wrongRate7d)
    .slice(0, 8)
    .map((card) => card.en);

  const recent = cards
    .filter((card) => {
      const diff = today.getTime() - new Date(card.createdAt).getTime();
      return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
    })
    .map((card) => card.en);

  const reviewTargets = unique([...due, ...weak, ...recent]).slice(0, 20);
  const newCandidates = cards
    .filter((card) => !reviewTargets.includes(card.en))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10)
    .map((card) => card.en);

  return {
    reviewTargets,
    grammarTargets: unique(grammarSignals).slice(0, 3),
    newCandidates
  };
}

export function chooseTargets(profile: LearningProfile) {
  const reviewCount = Math.max(1, Math.round(profile.reviewTargets.length * 0.7));
  const freshCount = Math.max(1, Math.round(reviewCount * (3 / 7)));
  return {
    review: profile.reviewTargets.slice(0, reviewCount),
    fresh: profile.newCandidates.slice(0, freshCount)
  };
}

export function calcCoverage(requiredTargets: string[], usedTargets: string[]): number {
  if (requiredTargets.length === 0) {
    return 1;
  }

  const usedSet = new Set(usedTargets.map((x) => x.trim().toLowerCase()));
  const hit = requiredTargets.filter((target) => usedSet.has(target.trim().toLowerCase()));
  return hit.length / requiredTargets.length;
}

export function estimateSimilarity(a: string, b: string): number {
  const toSet = (value: string) => new Set(value.toLowerCase().split(/\W+/).filter(Boolean));
  const left = toSet(a);
  const right = toSet(b);

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let same = 0;
  for (const token of left) {
    if (right.has(token)) {
      same += 1;
    }
  }

  return same / new Set([...left, ...right]).size;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
