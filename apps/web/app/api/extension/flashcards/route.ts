import { NextResponse } from "next/server";
import { addFlashcard, isValidServiceRoleToken } from "@/lib/flashcards";
import { createAdminSupabaseClient, resolveUserIdFromAccessToken } from "@/lib/service";

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const en = String(body?.en ?? "").trim();
    const ja = body?.ja ? String(body.ja).trim() : undefined;
    const source = body?.source === "extension" || body?.source === "chat" ? body.source : "extension";
    const headerToken = String(request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

    let userId = "";
    if (isValidServiceRoleToken(headerToken)) {
      userId = typeof body?.userId === "string" ? body.userId.trim() : "";
      if (!userId) {
        return withCors(NextResponse.json({ error: "userId is required for service-role requests" }, { status: 400 }));
      }
    } else {
      userId = (await resolveUserIdFromAccessToken(headerToken)) ?? "";
      if (!userId) {
        return withCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      }
    }

    if (!en) {
      return withCors(NextResponse.json({ error: "en is required" }, { status: 400 }));
    }

    const card = await addFlashcard({
      serviceClient: createAdminSupabaseClient(),
      userId,
      en,
      ja,
      source
    });

    return withCors(
      NextResponse.json({
        id: card.id,
        en: card.en,
        ja: card.ja,
        nextReviewAt: card.nextReviewAt,
        duplicated: card.duplicated
      })
    );
  } catch (error) {
    return withCors(NextResponse.json({ error: String(error) }, { status: 500 }));
  }
}
