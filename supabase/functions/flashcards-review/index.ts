import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { nextSm2 } from "../_shared/sm2.ts";

type QueueItem = {
  id: string;
  en: string;
  ja: string;
  nextReviewAt: string | null;
  isDue: boolean;
};

type FlashcardRow = {
  id: string;
  en: string;
  ja: string;
  created_at: string;
};

type FlashcardReviewRow = {
  flashcard_id: string;
  repetition: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string;
  reviewed_at: string;
};

const MAX_REVIEW_QUEUE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();

    const {
      data: { user },
      error: authError
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (req.method === "GET") {
      const queuePayload = await loadQueue(serviceClient, user.id);
      return json(queuePayload);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const flashcardId = typeof body?.flashcardId === "string" ? body.flashcardId.trim() : "";
      const remembered = body?.remembered;

      if (!flashcardId) {
        return json({ error: "flashcardId is required" }, 400);
      }
      if (typeof remembered !== "boolean") {
        return json({ error: "remembered must be boolean" }, 400);
      }

      const { data: card, error: cardError } = await serviceClient
        .from("flashcards")
        .select("id")
        .eq("id", flashcardId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (cardError) {
        throw cardError;
      }
      if (!card) {
        return json({ error: "Flashcard not found" }, 404);
      }

      const { data: latestReview, error: latestReviewError } = await serviceClient
        .from("flashcard_reviews")
        .select("repetition, interval_days, ease_factor")
        .eq("user_id", user.id)
        .eq("flashcard_id", flashcardId)
        .order("reviewed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestReviewError) {
        throw latestReviewError;
      }

      const quality = remembered ? 4 : 2;
      const sm2 = nextSm2({
        quality,
        repetition: latestReview?.repetition ?? 0,
        intervalDays: latestReview?.interval_days ?? 1,
        easeFactor: latestReview?.ease_factor ?? 2.5
      });

      const nextReviewAt = new Date();
      nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + sm2.intervalDays);

      const { error: insertError } = await serviceClient.from("flashcard_reviews").insert({
        flashcard_id: flashcardId,
        user_id: user.id,
        quality,
        interval_days: sm2.intervalDays,
        ease_factor: sm2.easeFactor,
        repetition: sm2.repetition,
        next_review_at: nextReviewAt.toISOString()
      });

      if (insertError) {
        throw insertError;
      }

      const queuePayload = await loadQueue(serviceClient, user.id);
      return json({
        ok: true,
        nextReviewAt: nextReviewAt.toISOString(),
        remaining: queuePayload.total,
        nextDueAt: queuePayload.nextDueAt
      });
    }

    return json({ error: "Method Not Allowed" }, 405);
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

async function loadQueue(serviceClient: any, userId: string): Promise<{ queue: QueueItem[]; total: number; nextDueAt: string | null }> {
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

  const latestByCard = new Map<string, FlashcardReviewRow>();
  for (const review of (reviews ?? []) as FlashcardReviewRow[]) {
    if (!latestByCard.has(review.flashcard_id)) {
      latestByCard.set(review.flashcard_id, review);
    }
  }

  const now = new Date();

  const due: QueueItem[] = [];
  const notDue: QueueItem[] = [];

  for (const card of (cards ?? []) as FlashcardRow[]) {
    const latest = latestByCard.get(card.id);
    const nextReviewAt = latest?.next_review_at ?? null;
    const isDue = Boolean(nextReviewAt && new Date(nextReviewAt) <= now);

    const item: QueueItem = {
      id: card.id,
      en: card.en,
      ja: card.ja,
      nextReviewAt,
      isDue
    };

    if (isDue) {
      due.push(item);
    } else {
      notDue.push(item);
    }
  }

  const createdAtById = new Map<string, string>();
  for (const card of (cards ?? []) as FlashcardRow[]) {
    createdAtById.set(card.id, card.created_at);
  }

  due.sort((a, b) => {
    const nextA = a.nextReviewAt ? new Date(a.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
    const nextB = b.nextReviewAt ? new Date(b.nextReviewAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (nextA !== nextB) {
      return nextA - nextB;
    }
    return (createdAtById.get(b.id) ?? "").localeCompare(createdAtById.get(a.id) ?? "");
  });

  notDue.sort((a, b) => (createdAtById.get(b.id) ?? "").localeCompare(createdAtById.get(a.id) ?? ""));

  const queue = [...due, ...notDue].slice(0, MAX_REVIEW_QUEUE);

  let nextDueAt: string | null = null;
  for (const review of latestByCard.values()) {
    const next = new Date(review.next_review_at);
    if (next <= now) {
      continue;
    }
    if (!nextDueAt || next < new Date(nextDueAt)) {
      nextDueAt = review.next_review_at;
    }
  }

  return {
    queue,
    total: queue.length,
    nextDueAt
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
