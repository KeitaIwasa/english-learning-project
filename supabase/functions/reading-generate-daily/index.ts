import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { appEnv } from "../_shared/env.ts";
import { generateWithGemini } from "../_shared/gemini.ts";
import { calcCoverage, chooseTargets, estimateSimilarity, type LearningProfile } from "../_shared/learning.ts";
import { computeLearningProfile } from "../_shared/profile-builder.ts";

const MIN_COVERAGE = 0.7;
const MAX_TRY = 3;

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
      .select("id, used_review_targets_json, used_new_targets_json")
      .eq("user_id", userId)
      .eq("generated_for_date", targetDate)
      .maybeSingle();

    if (existing) {
      return json({
        created: false,
        passageId: existing.id,
        usedReviewTargets: (existing.used_review_targets_json as string[] | null) ?? [],
        usedNewTargets: (existing.used_new_targets_json as string[] | null) ?? []
      });
    }

    const profileRow = await getOrBuildProfile(serviceClient, userId, body?.profileId, targetDate);
    const profile = rowToProfile(profileRow);
    const chosen = chooseTargets(profile);

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
          grammarTargets: profile.grammarTargets
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
      generated = fallbackReading(chosen.review, chosen.fresh, profile.grammarTargets);
      coverage = calcCoverage(chosen.review, generated.used_targets.review);
    }

    const rationale = {
      reason: "期限カード・誤答傾向・チャット要約特徴を反映",
      grammarTargets: profile.grammarTargets,
      coverage,
      requiredReviewCount: chosen.review.length,
      usedReviewCount: generated.used_targets.review.length
    };

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
        rationale_json: rationale
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ created: false });
      }
      throw insertError;
    }

    return json({
      created: true,
      passageId: inserted.id,
      usedReviewTargets: generated.used_targets.review,
      usedNewTargets: generated.used_targets.new
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
}): Promise<GeneratedReading> {
  const prompt = {
    requirements: {
      reviewRatio: "70%",
      newRatio: "30%",
      includeReviewTargets: params.reviewTargets,
      includeNewTargets: params.freshTargets,
      includeGrammarTargets: params.grammarTargets
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
      "あなたは英語学習コンテンツ生成アシスタントです。必ずJSONのみを返してください。本文は180〜220語程度で、音読しやすい自然な英文にしてください。",
    input: JSON.stringify(prompt),
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

function fallbackReading(reviewTargets: string[], freshTargets: string[], grammarTargets: string[]): GeneratedReading {
  const reviewText = reviewTargets.slice(0, 4).join(", ");
  const freshText = freshTargets.slice(0, 2).join(", ");

  const passage = `Today I will review what I learned recently. I want to reuse these expressions: ${reviewText}. I also challenge myself with new expressions like ${freshText}. While reading, I pay attention to grammar points such as ${grammarTargets.join(", ") || "word order"}. I write short sentences, read them aloud, and check if they sound natural. This routine helps me remember old knowledge and connect it to new ideas.`;

  return {
    title: "Daily Review Reading",
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
