import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceEnv } from "@/lib/service";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const en = String(formData.get("en") ?? "").trim();
  const ja = String(formData.get("ja") ?? "").trim();

  if (!en) {
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { supabaseUrl, serviceRoleKey } = getServiceEnv();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data: card, error: cardError } = await admin
    .from("flashcards")
    .insert({
      user_id: userData.user.id,
      en,
      ja: ja || null,
      source: "web"
    })
    .select("id")
    .single();

  if (cardError || !card) {
    console.error("flashcards insert failed:", cardError?.message ?? "no row returned");
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  const nextReviewAt = new Date();
  nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + 1);

  const { error: reviewError } = await admin.from("flashcard_reviews").insert({
    flashcard_id: card.id,
    user_id: userData.user.id,
    quality: 4,
    interval_days: 1,
    ease_factor: 2.5,
    repetition: 0,
    next_review_at: nextReviewAt.toISOString()
  });

  if (reviewError) {
    console.error("flashcard_reviews insert failed:", reviewError.message);
  }

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
