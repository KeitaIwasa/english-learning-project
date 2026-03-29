import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/service";
import { addFlashcard } from "@/lib/flashcards";

export async function POST(request: Request) {
  const formData = await request.formData();
  const en = String(formData.get("en") ?? "").trim();
  const ja = String(formData.get("ja") ?? "").trim();

  if (!en) {
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    await addFlashcard({
      serviceClient: createAdminSupabaseClient(),
      userId: user.id,
      en,
      ja: ja || undefined,
      source: "web"
    });
  } catch (error) {
    console.error("flashcards add failed:", error);
  }

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
