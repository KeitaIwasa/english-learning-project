import { buildLearningProfile, type FlashcardStat } from "./learning.ts";

export async function computeLearningProfile(params: {
  serviceClient: any;
  userId: string;
  lookbackDays: number;
  targetDate: string;
}) {
  const { serviceClient, userId, lookbackDays, targetDate } = params;

  const lookbackStart = new Date(`${targetDate}T00:00:00.000Z`);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - lookbackDays);
  const lookbackIso = lookbackStart.toISOString();

  const sevenDaysAgo = new Date(`${targetDate}T00:00:00.000Z`);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const { data: cards, error: cardsError } = await serviceClient
    .from("flashcards")
    .select("id, en, created_at")
    .eq("user_id", userId)
    .gte("created_at", lookbackIso)
    .order("created_at", { ascending: false });

  if (cardsError) {
    throw cardsError;
  }

  const cardIds = (cards ?? []).map((card: { id: string }) => card.id);

  const { data: reviews, error: reviewsError } = await serviceClient
    .from("flashcard_reviews")
    .select("flashcard_id, quality, reviewed_at, next_review_at")
    .eq("user_id", userId)
    .in("flashcard_id", cardIds.length > 0 ? cardIds : ["00000000-0000-0000-0000-000000000000"])
    .order("reviewed_at", { ascending: false });

  if (reviewsError) {
    throw reviewsError;
  }

  const reviewByCard = new Map<string, Array<{ quality: number; reviewed_at: string; next_review_at: string }>>();
  for (const review of reviews ?? []) {
    const list = reviewByCard.get(review.flashcard_id) ?? [];
    list.push(review);
    reviewByCard.set(review.flashcard_id, list);
  }

  const stats: FlashcardStat[] = (cards ?? []).map((card: { id: string; en: string; created_at: string }) => {
    const list = reviewByCard.get(card.id) ?? [];
    const latest = list[0];
    const recent7d = list.filter((review) => new Date(review.reviewed_at) >= sevenDaysAgo);
    const wrongCount = recent7d.filter((review) => review.quality <= 2).length;
    const wrongRate7d = recent7d.length > 0 ? wrongCount / recent7d.length : 0;

    return {
      id: card.id,
      en: card.en,
      createdAt: card.created_at,
      nextReviewAt: latest?.next_review_at ?? null,
      wrongRate7d
    };
  });

  const { data: rawSignals, error: signalError } = await serviceClient
    .from("chat_learning_signals")
    .select("signal_key, weight")
    .eq("user_id", userId)
    .gte("created_at", lookbackIso)
    .order("weight", { ascending: false })
    .limit(50);

  if (signalError) {
    throw signalError;
  }

  const weightedSignals = new Map<string, number>();
  for (const signal of rawSignals ?? []) {
    weightedSignals.set(signal.signal_key, (weightedSignals.get(signal.signal_key) ?? 0) + Number(signal.weight));
  }

  const topSignals = [...weightedSignals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([signal]) => signal);

  return buildLearningProfile(stats, topSignals, `${targetDate}T00:00:00.000Z`);
}
