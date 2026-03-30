import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { flashcardReviewRequestSchema } from "@/lib/schemas";
import { createAdminSupabaseClient } from "@/lib/service";
import { nextSm2 } from "@/lib/sm2";
import {
  buildReviewQueue,
  type FlashcardReviewRow,
  type FlashcardRow,
  type QueueItem
} from "@/lib/review-queue";

const MAX_REVIEW_QUEUE = 50;

async function getAuthUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queuePayload = await loadQueue(createAdminSupabaseClient(), userId);
    return NextResponse.json(queuePayload);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = flashcardReviewRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const serviceClient = createAdminSupabaseClient();

  try {
    const { data: card, error: cardError } = await serviceClient
      .from("flashcards")
      .select("id")
      .eq("id", parsed.data.flashcardId)
      .eq("user_id", userId)
      .maybeSingle();

    if (cardError) {
      throw cardError;
    }
    if (!card) {
      // Treat missing cards as an idempotent no-op. This can happen when a card
      // was deleted after the review queue was loaded but before submit.
      const nextDueAt = await findNextDueAt(serviceClient, userId);
      return NextResponse.json({ ok: true, skipped: true, flashcardId: parsed.data.flashcardId, nextDueAt });
    }

    const { data: latestReview, error: latestReviewError } = await serviceClient
      .from("flashcard_reviews")
      .select("repetition, interval_days, ease_factor")
      .eq("user_id", userId)
      .eq("flashcard_id", parsed.data.flashcardId)
      .order("reviewed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestReviewError) {
      throw latestReviewError;
    }

    const quality = parsed.data.remembered ? 4 : 2;
    const sm2 = nextSm2({
      quality,
      repetition: latestReview?.repetition ?? 0,
      intervalDays: latestReview?.interval_days ?? 1,
      easeFactor: latestReview?.ease_factor ?? 2.5
    });

    const nextReviewAt = new Date();
    nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + sm2.intervalDays);

    const { error: insertError } = await serviceClient.from("flashcard_reviews").insert({
      flashcard_id: parsed.data.flashcardId,
      user_id: userId,
      quality,
      interval_days: sm2.intervalDays,
      ease_factor: sm2.easeFactor,
      repetition: sm2.repetition,
      next_review_at: nextReviewAt.toISOString()
    });

    if (insertError) {
      throw insertError;
    }

    const nextDueAt = await findNextDueAt(serviceClient, userId);

    return NextResponse.json({
      ok: true,
      nextReviewAt: nextReviewAt.toISOString(),
      flashcardId: parsed.data.flashcardId,
      nextDueAt
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function findNextDueAt(
  serviceClient: ReturnType<typeof createAdminSupabaseClient>,
  userId: string
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await serviceClient
    .from("flashcard_reviews")
    .select("next_review_at")
    .eq("user_id", userId)
    .gt("next_review_at", nowIso)
    .order("next_review_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.next_review_at ?? null;
}

async function loadQueue(
  serviceClient: ReturnType<typeof createAdminSupabaseClient>,
  userId: string
): Promise<{ queue: QueueItem[]; total: number; nextDueAt: string | null }> {
  const { data: cards, error: cardsError } = await serviceClient
    .from("flashcards")
    .select("id, en, ja, created_at")
    .eq("user_id", userId);

  if (cardsError) {
    throw cardsError;
  }

  const { data: reviews, error: reviewsError } = await serviceClient
    .from("flashcard_reviews")
    .select("flashcard_id, repetition, interval_days, ease_factor, next_review_at, reviewed_at")
    .eq("user_id", userId)
    .order("reviewed_at", { ascending: false });

  if (reviewsError) {
    throw reviewsError;
  }

  return buildReviewQueue({
    cards: (cards ?? []) as FlashcardRow[],
    reviews: (reviews ?? []) as FlashcardReviewRow[],
    maxQueue: MAX_REVIEW_QUEUE
  });
}
