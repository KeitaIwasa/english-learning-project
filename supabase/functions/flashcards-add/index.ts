import { corsHeaders } from "../_shared/cors.ts";
import { addFlashcard } from "../_shared/flashcards.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

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

    const body = await req.json();
    const en = String(body?.en ?? "").trim();
    const ja = body?.ja ? String(body.ja).trim() : undefined;
    const source = body?.source === "extension" || body?.source === "chat" ? body.source : "web";

    if (!en) {
      return json({ error: "en is required" }, 400);
    }

    const card = await addFlashcard({
      serviceClient,
      userId: user.id,
      en,
      ja,
      source
    });

    return json({
      id: card.id,
      en: card.en,
      ja: card.ja,
      nextReviewAt: card.nextReviewAt
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
