import { generateWithGemini } from "./gemini.ts";
import { appEnv } from "./env.ts";

export async function addFlashcard(params: {
  serviceClient: any;
  userId: string;
  en: string;
  ja?: string;
  source: "web" | "extension" | "chat";
}) {
  const en = params.en.trim();
  if (!en) {
    throw new Error("English text is required");
  }

  let ja = params.ja?.trim();
  if (!ja) {
    const translated = await generateWithGemini({
      model: appEnv.geminiFastModel(),
      instruction:
        "Translate the user's English sentence into natural Japanese. Output only Japanese translation without any extra text.",
      input: en
    });
    ja = translated.text.trim();
  }

  const { data: card, error: cardError } = await params.serviceClient
    .from("flashcards")
    .insert({
      user_id: params.userId,
      en,
      ja,
      source: params.source
    })
    .select("id, en, ja")
    .single();

  if (cardError) {
    throw cardError;
  }

  const nextReviewAt = new Date();
  nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + 1);

  const { error: reviewError } = await params.serviceClient.from("flashcard_reviews").insert({
    flashcard_id: card.id,
    user_id: params.userId,
    quality: 4,
    interval_days: 1,
    ease_factor: 2.5,
    repetition: 0,
    next_review_at: nextReviewAt.toISOString()
  });

  if (reviewError) {
    throw reviewError;
  }

  return {
    id: card.id,
    en: card.en,
    ja: card.ja,
    nextReviewAt: nextReviewAt.toISOString()
  };
}
