export type FlashcardStat = {
  en: string;
  nextReviewAt: string | null;
  wrongRate7d: number;
  createdAt: string;
};

export type ChatSignal = {
  signalKey: string;
  weight: number;
};

export type LearningProfile = {
  reviewTargets: string[];
  grammarTargets: string[];
  newCandidates: string[];
};

const MAX_GRAMMAR_TARGETS = 3;

export function buildLearningProfile(
  cards: FlashcardStat[],
  signals: ChatSignal[],
  todayIso: string
): LearningProfile {
  const today = new Date(todayIso);

  const due = cards
    .filter((card) => card.nextReviewAt && new Date(card.nextReviewAt) <= today)
    .map((card) => card.en);

  const weak = cards
    .filter((card) => card.wrongRate7d >= 0.4)
    .sort((a, b) => b.wrongRate7d - a.wrongRate7d)
    .slice(0, 8)
    .map((card) => card.en);

  const recent = cards
    .filter((card) => {
      const createdAt = new Date(card.createdAt);
      const diff = today.getTime() - createdAt.getTime();
      return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
    })
    .map((card) => card.en);

  const reviewTargets = dedupe([...due, ...weak, ...recent]).slice(0, 20);

  const grammarTargets = dedupe(
    signals
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_GRAMMAR_TARGETS)
      .map((signal) => signal.signalKey)
  );

  const newCandidates = cards
    .filter((card) => !reviewTargets.includes(card.en))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10)
    .map((card) => card.en);

  return {
    reviewTargets,
    grammarTargets,
    newCandidates
  };
}

export function chooseTargets(profile: LearningProfile): {
  review: string[];
  fresh: string[];
} {
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

  const used = new Set(usedTargets.map(normalizeTarget));
  const matched = requiredTargets.filter((target) => used.has(normalizeTarget(target)));
  return matched.length / requiredTargets.length;
}

function normalizeTarget(value: string): string {
  return value.trim().toLowerCase();
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
