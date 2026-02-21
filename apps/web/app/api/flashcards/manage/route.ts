import { NextResponse } from "next/server";
import { z } from "zod";
import { flashcardManageDeleteSchema, flashcardManageUpdateSchema } from "@/lib/schemas";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type LatestReview = {
  flashcard_id: string;
  repetition: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string;
  reviewed_at: string;
};

const flashcardManageListQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

async function getAuth() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    supabase,
    userId: user.id
  };
}

function escapeForIlike(term: string) {
  return term.replace(/[%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const auth = await getAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedQuery = flashcardManageListQuerySchema.safeParse({
    q: request.url ? new URL(request.url).searchParams.get("q") ?? undefined : undefined,
    limit: request.url ? new URL(request.url).searchParams.get("limit") ?? undefined : undefined,
    offset: request.url ? new URL(request.url).searchParams.get("offset") ?? undefined : undefined
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 });
  }

  const { q, limit, offset } = parsedQuery.data;
  const queryText = q?.trim() ?? "";

  let cardsQuery = auth.supabase
    .from("flashcards")
    .select("id, en, ja, created_at, updated_at", { count: "exact" })
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (queryText) {
    const escaped = escapeForIlike(queryText);
    cardsQuery = cardsQuery.or(`en.ilike.%${escaped}%,ja.ilike.%${escaped}%`);
  }

  const { data: cards, count, error: cardsError } = await cardsQuery;
  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 });
  }

  const cardItems = cards ?? [];
  const cardIds = cardItems.map((card) => String(card.id));

  let latestByCard = new Map<string, LatestReview>();
  if (cardIds.length > 0) {
    const { data: reviews, error: reviewsError } = await auth.supabase
      .from("flashcard_reviews")
      .select("flashcard_id, repetition, interval_days, ease_factor, next_review_at, reviewed_at")
      .eq("user_id", auth.userId)
      .in("flashcard_id", cardIds)
      .order("reviewed_at", { ascending: false });

    if (reviewsError) {
      return NextResponse.json({ error: reviewsError.message }, { status: 500 });
    }

    latestByCard = new Map<string, LatestReview>();
    for (const review of (reviews ?? []) as LatestReview[]) {
      if (!latestByCard.has(review.flashcard_id)) {
        latestByCard.set(review.flashcard_id, review);
      }
    }
  }

  const items = cardItems.map((card) => {
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
  });

  return NextResponse.json({
    items,
    total: count ?? 0,
    limit,
    offset
  });
}

export async function PATCH(request: Request) {
  const auth = await getAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = flashcardManageUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id, en, ja } = parsed.data;

  const { data, error } = await auth.supabase
    .from("flashcards")
    .update({ en, ja })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id, en, ja, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Flashcard not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    item: {
      id: String(data.id),
      en: String(data.en),
      ja: String(data.ja),
      updated_at: String(data.updated_at)
    }
  });
}

export async function DELETE(request: Request) {
  const auth = await getAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = flashcardManageDeleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = parsed.data;

  const { data, error } = await auth.supabase
    .from("flashcards")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Flashcard not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: String(data.id) });
}
