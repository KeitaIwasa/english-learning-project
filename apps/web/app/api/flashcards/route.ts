import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/service";
import { addFlashcard } from "@/lib/flashcards";

export async function POST(request: Request) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  const formData = await request.formData();
  const en = String(formData.get("en") ?? "").trim();
  const ja = String(formData.get("ja") ?? "").trim();

  if (!en) {
    if (wantsJson) {
      return NextResponse.json({ ok: false, error: "English は必須です。" }, { status: 400 });
    }
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    if (wantsJson) {
      return NextResponse.json({ ok: false, error: "ログインが必要です。" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    const card = await addFlashcard({
      serviceClient: createAdminSupabaseClient(),
      userId: user.id,
      en,
      ja: ja || undefined,
      source: "web"
    });

    if (wantsJson) {
      return NextResponse.json({
        ok: true,
        item: {
          id: card.id,
          en: card.en,
          ja: card.ja,
          nextReviewAt: card.nextReviewAt,
          duplicated: card.duplicated
        }
      });
    }
  } catch (error) {
    console.error("flashcards add failed:", error);
    if (wantsJson) {
      return NextResponse.json({ ok: false, error: "カード追加に失敗しました。" }, { status: 500 });
    }
  }

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
