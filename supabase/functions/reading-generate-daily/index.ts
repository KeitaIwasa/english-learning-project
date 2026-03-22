import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { appEnv } from "../_shared/env.ts";
import { generateWithGemini, synthesizeSpeechWithGemini, type GeminiContent } from "../_shared/gemini.ts";
import {
  buildReadingConversation,
  type ReadingChatMessage,
  type ReadingFlashcard,
  type ReadingFlashcardReview
} from "../../../packages/shared/src/reading-conversation.ts";

const MAX_TRY = 3;
const MAX_TTS_TRY = 3;
const HISTORY_LOOKBACK_DAYS = 5;
const CONTEXT_MAX_CHARS = 32000;
const MAX_USED_TARGETS = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestedUserId = body?.userId ? String(body.userId) : null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const isServiceRoleCall = Boolean(requestedUserId) && getJwtRole(bearerToken) === "service_role";

    let userId: string;
    if (isServiceRoleCall) {
      userId = requestedUserId!;
    } else {
      const userClient = createUserClient(req);
      const {
        data: { user },
        error: authError
      } = await userClient.auth.getUser();

      if (authError || !user) {
        return json({ error: "Unauthorized" }, 401);
      }

      userId = user.id;
    }

    const serviceClient = createServiceClient();
    const targetDate = body?.date ? String(body.date) : todayDate();

    const { data: existing } = await serviceClient
      .from("reading_passages")
      .select("id, used_review_targets_json, used_new_targets_json, audio_base64, audio_mime_type")
      .eq("user_id", userId)
      .eq("generated_for_date", targetDate)
      .maybeSingle();

    if (existing) {
      const hasAudio = Boolean(existing.audio_base64 && existing.audio_mime_type);
      return json({
        created: false,
        passageId: existing.id,
        usedReviewTargets: (existing.used_review_targets_json as string[] | null) ?? [],
        usedNewTargets: (existing.used_new_targets_json as string[] | null) ?? [],
        hasAudio
      });
    }

    const sinceIso = isoDaysAgo(HISTORY_LOOKBACK_DAYS);
    const [{ data: chatRows, error: chatError }, { data: cardRows, error: cardError }] = await Promise.all([
      serviceClient
        .from("chat_messages")
        .select("thread_id, mode, role, content, created_at")
        .eq("user_id", userId)
        .in("mode", ["ask", "translate"])
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true }),
      serviceClient.from("flashcards").select("id, en, ja, created_at").eq("user_id", userId)
    ]);

    if (chatError) {
      throw chatError;
    }
    if (cardError) {
      throw cardError;
    }

    const cardIds = (cardRows ?? []).map((card: { id: string }) => card.id);
    const { data: reviewRows, error: reviewError } = await serviceClient
      .from("flashcard_reviews")
      .select("flashcard_id, quality, reviewed_at")
      .eq("user_id", userId)
      .in("flashcard_id", cardIds.length > 0 ? cardIds : ["00000000-0000-0000-0000-000000000000"])
      .order("reviewed_at", { ascending: false });

    if (reviewError) {
      throw reviewError;
    }

    const pseudoConversation = buildReadingConversation({
      chatMessages: (chatRows ?? []).map(
        (row: { mode: string; role: string; content: string; created_at: string; thread_id: string | null }) =>
          ({
            mode: row.mode,
            role: row.role,
            content: row.content,
            createdAt: row.created_at,
            threadId: row.thread_id
          }) satisfies ReadingChatMessage
      ),
      flashcards: (cardRows ?? []).map(
        (row: { id: string; en: string; ja: string; created_at: string }) =>
          ({
            id: row.id,
            en: row.en,
            ja: row.ja,
            createdAt: row.created_at
          }) satisfies ReadingFlashcard
      ),
      flashcardReviews: (reviewRows ?? []).map(
        (row: { flashcard_id: string; quality: number; reviewed_at: string }) =>
          ({
            flashcardId: row.flashcard_id,
            quality: Number(row.quality),
            reviewedAt: row.reviewed_at
          }) satisfies ReadingFlashcardReview
      ),
      maxChars: CONTEXT_MAX_CHARS
    });

    console.log(
      `[reading-generate-daily] pseudo-context userId=${userId} askCount=${pseudoConversation.stats.askCount} translatePairCount=${pseudoConversation.stats.translatePairCount} flashcardPairCount=${pseudoConversation.stats.flashcardPairCount} trimmedCount=${pseudoConversation.stats.trimmedCount} contextChars=${pseudoConversation.stats.contextChars}`
    );

    const conversationContents: GeminiContent[] = pseudoConversation.turns.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }]
    }));

    let generated: GeneratedReading | null = null;
    for (let attempt = 0; attempt < MAX_TRY; attempt += 1) {
      try {
        generated = await generateReading({
          conversationContents
        });
        break;
      } catch (error) {
        console.error(`[reading-generate-daily] generation attempt failed (${attempt + 1}/${MAX_TRY})`, error);
      }
    }

    if (!generated) {
      generated = fallbackReading();
    }

    let ttsAudio: { audioBase64: string; mimeType: string; voice: string } | null = null;
    for (let attempt = 0; attempt < MAX_TTS_TRY; attempt += 1) {
      try {
        const voice = appEnv.geminiTtsVoice();
        const response = await synthesizeSpeechWithGemini({
          text: generated.passage,
          model: appEnv.geminiTtsModel(),
          voice
        });

        ttsAudio = {
          audioBase64: response.audioBase64,
          mimeType: response.mimeType,
          voice
        };
        break;
      } catch (error) {
        console.error(`[reading-generate-daily] tts attempt failed (${attempt + 1}/${MAX_TTS_TRY})`, error);
      }
    }

    const usedReviewTargets = pseudoConversation.usedReviewTargets.slice(0, MAX_USED_TARGETS);
    const usedNewTargets = pseudoConversation.usedNewTargets.slice(0, MAX_USED_TARGETS);
    const rationale = {
      reason: "5日以内のask/翻訳履歴と未習熟フラッシュカードを擬似会話として反映",
      askCount: pseudoConversation.stats.askCount,
      translatePairCount: pseudoConversation.stats.translatePairCount,
      flashcardPairCount: pseudoConversation.stats.flashcardPairCount,
      trimmedCount: pseudoConversation.stats.trimmedCount,
      contextChars: pseudoConversation.stats.contextChars
    };

    const { data: inserted, error: insertError } = await serviceClient
      .from("reading_passages")
      .insert({
        user_id: userId,
        profile_id: null,
        title: generated.title,
        body_en: generated.passage,
        glossary_ja_json: generated.glossary,
        difficulty: "A2-B1",
        generated_for_date: targetDate,
        used_review_targets_json: usedReviewTargets,
        used_new_targets_json: usedNewTargets,
        audio_base64: ttsAudio?.audioBase64 ?? null,
        audio_mime_type: ttsAudio?.mimeType ?? null,
        audio_voice: ttsAudio?.voice ?? null,
        rationale_json: rationale
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: duplicated } = await serviceClient
          .from("reading_passages")
          .select("id, used_review_targets_json, used_new_targets_json, audio_base64, audio_mime_type")
          .eq("user_id", userId)
          .eq("generated_for_date", targetDate)
          .maybeSingle();
        return json({
          created: false,
          passageId: duplicated?.id ?? null,
          usedReviewTargets: (duplicated?.used_review_targets_json as string[] | null) ?? [],
          usedNewTargets: (duplicated?.used_new_targets_json as string[] | null) ?? [],
          hasAudio: Boolean(duplicated?.audio_base64 && duplicated?.audio_mime_type)
        });
      }
      throw insertError;
    }

    return json({
      created: true,
      passageId: inserted.id,
      usedReviewTargets,
      usedNewTargets,
      hasAudio: Boolean(ttsAudio)
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

type GeneratedReading = {
  title: string;
  passage: string;
  glossary: Array<{ en: string; ja: string }>;
  review_points: Array<{ target: string; explanationJa: string; excerpt: string }>;
  used_targets: {
    review: string[];
    new: string[];
  };
};

async function generateReading(params: { conversationContents: GeminiContent[] }): Promise<GeneratedReading> {
  const finalPrompt = [
    "以下の会話履歴を学習文脈として、英語学習者向けの音読トレーニング文章を作ってください。",
    "必須条件:",
    "- 本文は180〜220語程度の自然な英文",
    "- 音読しやすい構文と語彙難易度（A2-B1）",
    "- 学習文脈に沿った語彙・言い回しを適度に再利用",
    "- 必ずJSONのみを返す",
    "- 出力スキーマ:",
    '{ "title": "string", "passage": "string", "glossary": [{ "en": "string", "ja": "string" }], "review_points": [{ "target": "string", "explanationJa": "string", "excerpt": "string" }], "used_targets": { "review": ["string"], "new": ["string"] } }'
  ].join("\n");

  const contents: GeminiContent[] = [
    ...params.conversationContents,
    {
      role: "user",
      parts: [{ text: finalPrompt }]
    }
  ];

  const generated = await generateWithGemini({
    model: appEnv.geminiReasoningModel(),
    instruction:
      "あなたは英語学習コンテンツ生成アシスタントです。与えられた会話履歴を学習文脈として活用し、必ずJSONのみを返してください。",
    contents,
    responseMimeType: "application/json"
  });

  const parsed = parseGeneratedReadingJson(generated.text);
  if (!parsed?.title || !parsed?.passage || !parsed?.used_targets?.review || !parsed?.used_targets?.new) {
    throw new Error("Invalid generated reading format");
  }

  return {
    title: parsed.title,
    passage: parsed.passage,
    glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
    review_points: Array.isArray(parsed.review_points) ? parsed.review_points : [],
    used_targets: {
      review: parsed.used_targets.review.map((item) => String(item)),
      new: parsed.used_targets.new.map((item) => String(item))
    }
  };
}

function fallbackReading(): GeneratedReading {
  const passage =
    "Mika started her day with a short English routine before work. She opened her notebook and wrote three simple goals: review one old phrase, learn one new phrase, and speak for five minutes without stopping. First, she practiced a phrase she had learned before and tried to use it in two new sentences. Then she checked a new expression and compared it with a similar one to understand the difference in nuance. During lunch, she sent a short message in English to a friend and read the reply aloud. In the evening, she listened to a short dialogue and repeated each line slowly, paying attention to stress and rhythm. She noticed that clear pronunciation helped her remember the words better. Before bed, she recorded a one-minute summary of her day in English. The routine was simple, but it made her feel more confident and prepared for real conversations.";

  return {
    title: "Daily English Routine",
    passage,
    glossary: [
      { en: "routine", ja: "習慣" },
      { en: "stress", ja: "強勢" },
      { en: "nuance", ja: "ニュアンス" }
    ],
    review_points: [],
    used_targets: {
      review: [],
      new: []
    }
  };
}

function parseGeneratedReadingJson(rawText: string): GeneratedReading {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed) as GeneratedReading;
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]) as GeneratedReading;
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as GeneratedReading;
    }

    throw new Error("Failed to parse generated reading JSON");
  }
}

function getJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = decodeBase64Url(parts[1]);
    const parsed = JSON.parse(payload) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function isoDaysAgo(days: number): string {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
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
