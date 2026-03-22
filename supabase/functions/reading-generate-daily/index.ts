import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { appEnv } from "../_shared/env.ts";
import { generateWithGemini, synthesizeSpeechWithGemini } from "../_shared/gemini.ts";
import { calcCoverage, chooseTargets, estimateSimilarity, type LearningProfile } from "../_shared/learning.ts";
import { computeLearningProfile } from "../_shared/profile-builder.ts";

const MIN_COVERAGE = 0.7;
const MAX_TRY = 3;
const MAX_TTS_TRY = 3;
const MAX_TTS_SPEAKERS = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;
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

    if (existing && !forceRegenerate) {
      const hasAudio = Boolean(existing.audio_base64 && existing.audio_mime_type);
      return json({
        created: false,
        passageId: existing.id,
        usedReviewTargets: (existing.used_review_targets_json as string[] | null) ?? [],
        usedNewTargets: (existing.used_new_targets_json as string[] | null) ?? [],
        hasAudio
      });
    }

    const profileRow = await getOrBuildProfile(serviceClient, userId, body?.profileId, targetDate);
    const profile = rowToProfile(profileRow);
    const chosen = chooseTargets(profile);
    const speakerVoiceConfigs = [
      {
        speaker: appEnv.geminiTtsSpeaker1Name(),
        voice: appEnv.geminiTtsSpeaker1Voice()
      },
      {
        speaker: appEnv.geminiTtsSpeaker2Name(),
        voice: appEnv.geminiTtsSpeaker2Voice()
      }
    ];
    const audioVoiceLabel = speakerVoiceConfigs.map((item) => `${item.speaker}:${item.voice}`).join(",");

    const { data: yesterday } = await serviceClient
      .from("reading_passages")
      .select("body_en")
      .eq("user_id", userId)
      .lt("generated_for_date", targetDate)
      .order("generated_for_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    let generated: GeneratedReading | null = null;
    let coverage = 0;

    for (let attempt = 0; attempt < MAX_TRY; attempt += 1) {
      try {
        const candidate = await generateReading({
          reviewTargets: chosen.review,
          freshTargets: chosen.fresh,
          grammarTargets: profile.grammarTargets,
          speakerNames: speakerVoiceConfigs.map((item) => item.speaker)
        });

        const candidateCoverage = calcCoverage(chosen.review, candidate.used_targets.review);
        const similarity = yesterday?.body_en ? estimateSimilarity(yesterday.body_en, candidate.passage) : 0;

        if (candidateCoverage >= MIN_COVERAGE && similarity < 0.8) {
          generated = candidate;
          coverage = candidateCoverage;
          break;
        }
      } catch (error) {
        console.error(`[reading-generate-daily] generation attempt failed (${attempt + 1}/${MAX_TRY})`, error);
      }
    }

    if (!generated) {
      generated = fallbackReading(chosen.review, chosen.fresh, profile.grammarTargets, speakerVoiceConfigs.map((item) => item.speaker));
      coverage = calcCoverage(chosen.review, generated.used_targets.review);
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

    const rationale = {
      reason: "期限カード・誤答傾向・チャット要約特徴を反映",
      grammarTargets: profile.grammarTargets,
      coverage,
      requiredReviewCount: chosen.review.length,
      usedReviewCount: generated.used_targets.review.length
    };

    let passageId: string;
    if (existing) {
      const { data: updated, error: updateError } = await serviceClient
        .from("reading_passages")
        .update({
          profile_id: profileRow.id,
          title: generated.title,
          body_en: generated.passage,
          glossary_ja_json: generated.glossary,
          difficulty: "A2-B1",
          used_review_targets_json: generated.used_targets.review,
          used_new_targets_json: generated.used_targets.new,
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
          profile_id: profileRow.id,
          title: generated.title,
          body_en: generated.passage,
          glossary_ja_json: generated.glossary,
          difficulty: "A2-B1",
          generated_for_date: targetDate,
          used_review_targets_json: generated.used_targets.review,
          used_new_targets_json: generated.used_targets.new,
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
            .select("id, audio_base64, audio_mime_type")
            .eq("user_id", userId)
            .eq("generated_for_date", targetDate)
            .maybeSingle();
          return json({
            created: false,
            passageId: duplicated?.id ?? null,
            hasAudio: Boolean(duplicated?.audio_base64 && duplicated?.audio_mime_type)
          });
        }
        throw insertError;
      }

      passageId = inserted.id;
    }

    return json({
      created: true,
      passageId,
      usedReviewTargets: generated.used_targets.review,
      usedNewTargets: generated.used_targets.new,
      hasAudio: Boolean(ttsAudio)
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

type LearningProfileRow = {
  id: string;
  review_targets_json: unknown;
  grammar_targets_json: unknown;
  new_candidates_json: unknown;
};

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

async function getOrBuildProfile(
  serviceClient: any,
  userId: string,
  profileId: string | undefined,
  targetDate: string
): Promise<LearningProfileRow> {
  if (profileId) {
    const { data, error } = await serviceClient
      .from("learning_profiles")
      .select("id, review_targets_json, grammar_targets_json, new_candidates_json")
      .eq("id", profileId)
      .eq("user_id", userId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data: existing } = await serviceClient
    .from("learning_profiles")
    .select("id, review_targets_json, grammar_targets_json, new_candidates_json")
    .eq("user_id", userId)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const profile = await computeLearningProfile({
    serviceClient,
    userId,
    lookbackDays: 14,
    targetDate
  });

  const { data: upserted, error: upsertError } = await serviceClient
    .from("learning_profiles")
    .upsert(
      {
        user_id: userId,
        target_date: targetDate,
        lookback_days: 14,
        review_targets_json: profile.reviewTargets,
        grammar_targets_json: profile.grammarTargets,
        new_candidates_json: profile.newCandidates
      },
      { onConflict: "user_id,target_date" }
    )
    .select("id, review_targets_json, grammar_targets_json, new_candidates_json")
    .single();

  if (upsertError) {
    throw upsertError;
  }

  return upserted;
}

async function generateReading(params: {
  reviewTargets: string[];
  freshTargets: string[];
  grammarTargets: string[];
  speakerNames: string[];
}): Promise<GeneratedReading> {
  const speakerNames = (params.speakerNames ?? []).map((name) => String(name ?? "").trim()).filter(Boolean).slice(0, MAX_TTS_SPEAKERS);
  if (speakerNames.length !== MAX_TTS_SPEAKERS) {
    throw new Error("Invalid speaker names");
  }
  const [speaker1, speaker2] = speakerNames;

  const prompt = {
    requirements: {
      reviewRatio: "70%",
      newRatio: "30%",
      includeReviewTargets: params.reviewTargets,
      includeNewTargets: params.freshTargets,
      includeGrammarTargets: params.grammarTargets,
      speakers: speakerNames,
      scriptStyle: "2人の会話台本。各行を「話者名: セリフ」で記述。地の文は禁止。"
    },
    outputSchema: {
      title: "string",
      passage: "string",
      glossary: [{ en: "string", ja: "string" }],
      review_points: [{ target: "string", explanationJa: "string", excerpt: "string" }],
      used_targets: {
        review: ["string"],
        new: ["string"]
      }
    }
  };

  const generated = await generateWithGemini({
    model: appEnv.geminiReasoningModel(),
    instruction:
      `あなたは英語学習コンテンツ生成アシスタントです。必ずJSONのみを返してください。本文は英語の2人会話台本として180〜220語程度で作成してください。` +
      `使用できる話者名は「${speaker1}」と「${speaker2}」のみです。` +
      `passageは複数行の台本にし、すべての行を「話者名: セリフ」形式にしてください。地の文・説明文は禁止です。`,
    input: JSON.stringify(prompt),
    responseMimeType: "application/json"
  });

  const parsed = parseGeneratedReadingJson(generated.text);
  if (!parsed?.title || !parsed?.passage || !parsed?.used_targets?.review || !parsed?.used_targets?.new) {
    throw new Error("Invalid generated reading format");
  }
  const scriptLines = String(parsed.passage ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const speakerPrefixSet = new Set(speakerNames.map((speaker) => `${speaker}:`));
  const hasOnlyAllowedSpeakers = scriptLines.length > 0 && scriptLines.every((line) => {
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
  const usedSpeakerSet = new Set(
    scriptLines
      .map((line) => line.split(":")[0]?.trim() ?? "")
      .filter(Boolean)
  );
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

function fallbackReading(
  reviewTargets: string[],
  freshTargets: string[],
  grammarTargets: string[],
  speakerNames: string[]
): GeneratedReading {
  const [speaker1, speaker2] = speakerNames;
  const reviewText = reviewTargets.slice(0, 4).join(", ");
  const freshText = freshTargets.slice(0, 2).join(", ");
  const grammarText = grammarTargets.join(", ") || "word order";
  const passage = [
    `${speaker1}: Let's practice our daily English conversation.`,
    `${speaker2}: Great idea. We should recycle these expressions: ${reviewText}.`,
    `${speaker1}: Yes, and let's add new ones like ${freshText}.`,
    `${speaker2}: I'll ask questions, and you answer with clear and natural sentences.`,
    `${speaker1}: Sounds good. I'll focus on grammar points such as ${grammarText}.`,
    `${speaker2}: Keep your pace steady so each line is easy to read aloud.`,
    `${speaker1}: After each answer, I'll rephrase it once to make it smoother.`,
    `${speaker2}: Nice. Repetition helps us remember and connect old and new phrases.`,
    `${speaker1}: Then let's finish with one short summary together.`,
    `${speaker2}: Perfect. Daily dialog practice will make our speaking more automatic.`
  ].join("\n");

  return {
    title: "Daily Review Dialogue",
    passage,
    glossary: [
      { en: "routine", ja: "習慣" },
      { en: "expression", ja: "表現" }
    ],
    review_points: reviewTargets.slice(0, 3).map((target) => ({
      target,
      explanationJa: "既習表現として再登場",
      excerpt: target
    })),
    used_targets: {
      review: reviewTargets.slice(0, 4),
      new: freshTargets.slice(0, 2)
    }
  };
}

function rowToProfile(row: LearningProfileRow): LearningProfile {
  return {
    reviewTargets: Array.isArray(row.review_targets_json) ? (row.review_targets_json as string[]) : [],
    grammarTargets: Array.isArray(row.grammar_targets_json) ? (row.grammar_targets_json as string[]) : [],
    newCandidates: Array.isArray(row.new_candidates_json) ? (row.new_candidates_json as string[]) : []
  };
}

function parseGeneratedReadingJson(rawText: string): GeneratedReading {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed) as GeneratedReading;
  } catch {
    // Gemini may occasionally wrap JSON with ```json fences even when JSON is requested.
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
