import { appEnv } from "@/lib/app-env";
import {
  buildReadingConversation,
  type ReadingChatMessage,
  type ReadingFlashcard,
  type ReadingFlashcardReview
} from "@/lib/shared";
import { generateWithGemini, synthesizeSpeechWithGemini, type GeminiContent } from "@/lib/gemini";
import { createAdminSupabaseClient } from "@/lib/service";

const MAX_TRY = 3;
const MAX_TTS_TRY = 3;
const MAX_TTS_SPEAKERS = 2;
const HISTORY_LOOKBACK_DAYS = 5;
const CONTEXT_MAX_CHARS = 32000;
const MAX_USED_TARGETS = 20;
const READING_SPEAKER_NAMES = ["Keita", "May"] as const;

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

export async function runReadingGenerateDaily(params: {
  serviceClient: ReturnType<typeof createAdminSupabaseClient>;
  userId: string;
  targetDate: string;
  forceRegenerate: boolean;
}) {
  const { serviceClient, userId, targetDate, forceRegenerate } = params;

  const { data: existing } = await serviceClient
    .from("reading_passages")
    .select("id, used_review_targets_json, used_new_targets_json, audio_base64, audio_mime_type")
    .eq("user_id", userId)
    .eq("generated_for_date", targetDate)
    .maybeSingle();

  if (existing && !forceRegenerate) {
    const hasAudio = Boolean(existing.audio_base64 && existing.audio_mime_type);
    return {
      created: false,
      passageId: existing.id,
      usedReviewTargets: (existing.used_review_targets_json as string[] | null) ?? [],
      usedNewTargets: (existing.used_new_targets_json as string[] | null) ?? [],
      hasAudio
    };
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

  const speakerNames = [...READING_SPEAKER_NAMES];

  if (speakerNames.length !== MAX_TTS_SPEAKERS) {
    throw new Error("Invalid speaker configuration");
  }

  const speakerVoiceConfigs = [
    { speaker: speakerNames[0], voice: appEnv.geminiTtsSpeaker1Voice() },
    { speaker: speakerNames[1], voice: appEnv.geminiTtsSpeaker2Voice() }
  ];

  const audioVoiceLabel = speakerVoiceConfigs.map((item) => `${item.speaker}:${item.voice}`).join(",");

  const conversationContents: GeminiContent[] = pseudoConversation.turns.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }]
  }));

  let generated: GeneratedReading | null = null;
  for (let attempt = 0; attempt < MAX_TRY; attempt += 1) {
    try {
      generated = await generateReading({
        conversationContents,
        speakerNames
      });
      break;
    } catch (error) {
      console.error(`[reading-generate-daily] generation attempt failed (${attempt + 1}/${MAX_TRY})`, error);
    }
  }

  if (!generated) {
    generated = fallbackReading(speakerNames);
  }

  let ttsAudio: { audioBase64: string; mimeType: string; voiceLabel: string } | null = null;
  for (let attempt = 0; attempt < MAX_TTS_TRY; attempt += 1) {
    try {
      const response = await synthesizeSpeechWithGemini({
        text: generated.passage,
        model: appEnv.geminiTtsModel(),
        speakerVoiceConfigs
      });

      ttsAudio = {
        audioBase64: response.audioBase64,
        mimeType: response.mimeType,
        voiceLabel: audioVoiceLabel
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

  let passageId: string;
  if (existing) {
    const { data: updated, error: updateError } = await serviceClient
      .from("reading_passages")
      .update({
        profile_id: null,
        title: generated.title,
        body_en: generated.passage,
        glossary_ja_json: generated.glossary,
        difficulty: "A2-B1",
        used_review_targets_json: usedReviewTargets,
        used_new_targets_json: usedNewTargets,
        audio_base64: ttsAudio?.audioBase64 ?? null,
        audio_mime_type: ttsAudio?.mimeType ?? null,
        audio_voice: ttsAudio?.voiceLabel ?? null,
        rationale_json: rationale
      })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select("id")
      .single();

    if (updateError) {
      throw updateError;
    }
    passageId = updated.id;
  } else {
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
        audio_voice: ttsAudio?.voiceLabel ?? null,
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
        return {
          created: false,
          passageId: duplicated?.id ?? null,
          usedReviewTargets: (duplicated?.used_review_targets_json as string[] | null) ?? [],
          usedNewTargets: (duplicated?.used_new_targets_json as string[] | null) ?? [],
          hasAudio: Boolean(duplicated?.audio_base64 && duplicated?.audio_mime_type)
        };
      }
      throw insertError;
    }

    passageId = inserted.id;
  }

  return {
    created: true,
    passageId,
    usedReviewTargets,
    usedNewTargets,
    hasAudio: Boolean(ttsAudio)
  };
}

async function generateReading(params: {
  conversationContents: GeminiContent[];
  speakerNames: string[];
}): Promise<GeneratedReading> {
  const speakerNames = (params.speakerNames ?? [])
    .map((name) => String(name ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_TTS_SPEAKERS);

  if (speakerNames.length !== MAX_TTS_SPEAKERS) {
    throw new Error("Invalid speaker names");
  }

  const finalPrompt = [
    "これまでの会話履歴を学習文脈として、英語学習者向けの音読トレーニング文章を作ってください。",
    "必須条件:",
    "- 本文は英語の2人会話台本として180〜220語程度",
    `- 使用できる話者名は「${speakerNames[0]}」と「${speakerNames[1]}」のみ`,
    "- 各行を「話者名: セリフ」形式にし、地の文は禁止",
    "- 学習文脈に沿った語彙・言い回し・文法などを適度に再利用。ただし、無理にすべて利用する必要はない。自然なストーリ・会話になるように取捨選択して。",
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
      "あなたは英語学習コンテンツ生成アシスタントです。与えられた会話履歴を学習文脈として適度に活用し、必ずJSONのみを返してください。",
    contents,
    responseMimeType: "application/json"
  });

  const parsed = parseGeneratedReadingJson(generated.text);
  if (!parsed?.title || !parsed?.passage || !parsed?.used_targets?.review || !parsed?.used_targets?.new) {
    throw new Error("Invalid generated reading format");
  }

  const speakerPrefixSet = new Set(speakerNames.map((speaker) => `${speaker}:`));
  const scriptLines = String(parsed.passage ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const hasOnlyAllowedSpeakers =
    scriptLines.length > 0 &&
    scriptLines.every((line) => {
      for (const prefix of speakerPrefixSet) {
        if (line.startsWith(prefix)) {
          return true;
        }
      }
      return false;
    });

  if (!hasOnlyAllowedSpeakers) {
    throw new Error("Generated script is not in expected multi-speaker format");
  }

  const usedSpeakerSet = new Set(scriptLines.map((line) => line.split(":")[0]?.trim() ?? "").filter(Boolean));
  if (!speakerNames.every((speaker) => usedSpeakerSet.has(speaker))) {
    throw new Error("Generated script is missing one or more speakers");
  }

  return {
    title: parsed.title,
    passage: scriptLines.join("\n"),
    glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
    review_points: Array.isArray(parsed.review_points) ? parsed.review_points : [],
    used_targets: {
      review: parsed.used_targets.review.map((item) => String(item)),
      new: parsed.used_targets.new.map((item) => String(item))
    }
  };
}

function fallbackReading(speakerNames: string[]): GeneratedReading {
  const [speaker1, speaker2] = speakerNames;
  const passage = [
    `${speaker1}: Let's review what we practiced this week and keep our sentences short and clear.`,
    `${speaker2}: Great. I will ask questions, and you answer naturally with one useful phrase each time.`,
    `${speaker1}: Good idea. I also want to reuse familiar words so I can speak more smoothly.`,
    `${speaker2}: Then add one new expression in each turn and connect it to a real daily situation.`,
    `${speaker1}: I'll focus on pronunciation and rhythm while I read each line aloud twice.`,
    `${speaker2}: Nice. Repetition plus context will help you remember and use the phrases faster.`,
    `${speaker1}: After this, I will summarize our dialogue in one minute to check my fluency.`,
    `${speaker2}: Perfect. This routine is simple, but it builds confidence for real conversations.`
  ].join("\n");

  return {
    title: "Daily Review Dialogue",
    passage,
    glossary: [
      { en: "repetition", ja: "反復" },
      { en: "fluency", ja: "流暢さ" },
      { en: "context", ja: "文脈" }
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

function isoDaysAgo(days: number): string {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}
