import { corsHeaders } from "../_shared/cors.ts";
import { appEnv } from "../_shared/env.ts";
import { addFlashcard } from "../_shared/flashcards.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();
    const body = await req.json();
    const en = String(body?.en ?? "").trim();
    const ja = body?.ja ? String(body.ja).trim() : undefined;
    const source = body?.source === "extension" || body?.source === "chat" ? body.source : "web";
    const headerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
    const serviceToken = appEnv.supabaseServiceRoleKey();

    let userId = "";
    if (headerToken && headerToken === serviceToken) {
      userId = typeof body?.userId === "string" ? body.userId.trim() : "";
      if (!userId) {
        return json({ error: "userId is required for service-role requests" }, 400);
      }
    } else {
      const {
        data: { user },
        error: authError
      } = await userClient.auth.getUser();

      if (authError || !user) {
        return json({ error: "Unauthorized" }, 401);
      }
      userId = user.id;
    }

    if (!en) {
      return json({ error: "en is required" }, 400);
    }

    const card = await addFlashcard({
      serviceClient,
      userId,
      en,
      ja,
      source
    });

    return json({
      id: card.id,
      en: card.en,
      ja: card.ja,
      nextReviewAt: card.nextReviewAt,
      duplicated: card.duplicated
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
