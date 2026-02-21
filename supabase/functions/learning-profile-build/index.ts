import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { computeLearningProfile } from "../_shared/profile-builder.ts";

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

    const body = await req.json().catch(() => ({}));
    const lookbackDays = Number(body?.lookbackDays ?? 14);
    const targetDate = body?.date ? String(body.date) : nowDate();

    const profile = await computeLearningProfile({
      serviceClient,
      userId: user.id,
      lookbackDays,
      targetDate
    });

    const { data: upserted, error: upsertError } = await serviceClient
      .from("learning_profiles")
      .upsert(
        {
          user_id: user.id,
          target_date: targetDate,
          lookback_days: lookbackDays,
          review_targets_json: profile.reviewTargets,
          grammar_targets_json: profile.grammarTargets,
          new_candidates_json: profile.newCandidates
        },
        { onConflict: "user_id,target_date" }
      )
      .select("id")
      .single();

    if (upsertError) {
      throw upsertError;
    }

    return json({
      profileId: upserted.id,
      reviewTargets: profile.reviewTargets,
      grammarTargets: profile.grammarTargets,
      newCandidates: profile.newCandidates
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

function nowDate() {
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
