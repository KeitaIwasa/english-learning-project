import { createSupabaseServerClient } from "@/lib/supabase-server";

type AppSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type LatestReview = {
  flashcard_id: string;
  repetition: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string;
  reviewed_at: string;
};

export function escapeForIlike(term: string) {
  return term.replace(/[%_]/g, "\\$&");
}

export async function listManagedFlashcards(params: {
  supabase: AppSupabaseClient;
  userId: string;
  queryText: string;
  limit: number;
  offset: number;
}) {
  let cardsQuery = params.supabase
    .from("flashcards")
    .select("id, en, ja, created_at, updated_at", { count: "exact" })
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (params.queryText) {
    const escaped = escapeForIlike(params.queryText);
    cardsQuery = cardsQuery.or(`en.ilike.%${escaped}%,ja.ilike.%${escaped}%`);
  }

  const { data: cards, count, error: cardsError } = await cardsQuery;
  if (cardsError) {
    throw cardsError;
  }

  const cardItems = cards ?? [];
  const cardIds = cardItems.map((card) => String(card.id));

  const latestByCard = new Map<string, LatestReview>();
  if (cardIds.length > 0) {
    const { data: reviews, error: reviewsError } = await params.supabase
      .from("flashcard_reviews")
      .select("flashcard_id, repetition, interval_days, ease_factor, next_review_at, reviewed_at")
      .eq("user_id", params.userId)
      .in("flashcard_id", cardIds)
      .order("reviewed_at", { ascending: false });

    if (reviewsError) {
      throw reviewsError;
    }
    for (const review of (reviews ?? []) as LatestReview[]) {
      if (!latestByCard.has(review.flashcard_id)) {
        latestByCard.set(review.flashcard_id, review);
      }
    }
  }

  return {
    items: cardItems.map((card) => {
      const review = latestByCard.get(String(card.id));
      return {
        id: String(card.id),
        en: String(card.en),
        ja: String(card.ja),
        created_at: String(card.created_at),
        updated_at: String(card.updated_at),
        sm2: review
          ? {
              repetition: review.repetition,
              intervalDays: review.interval_days,
              easeFactor: Number(review.ease_factor),
              nextReviewAt: review.next_review_at,
              reviewedAt: review.reviewed_at
            }
          : null
      };
    }),
    total: count ?? 0,
    limit: params.limit,
    offset: params.offset
  };
}

export async function updateManagedFlashcard(params: {
  supabase: AppSupabaseClient;
  userId: string;
  id: string;
  en: string;
  ja: string;
}) {
  const { data, error } = await params.supabase
    .from("flashcards")
    .update({ en: params.en, ja: params.ja })
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .select("id, en, ja, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return {
    ok: true,
    item: {
      id: String(data.id),
      en: String(data.en),
      ja: String(data.ja),
      updated_at: String(data.updated_at)
    }
  };
}

export async function deleteManagedFlashcard(params: {
  supabase: AppSupabaseClient;
  userId: string;
  id: string;
}) {
  const { data, error } = await params.supabase
    .from("flashcards")
    .delete()
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return {
    ok: true,
    id: String(data.id)
  };
}
