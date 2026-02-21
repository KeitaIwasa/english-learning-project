import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const en = String(formData.get("en") ?? "").trim();
  const ja = String(formData.get("ja") ?? "").trim();

  if (!en) {
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  await supabase.functions.invoke("flashcards-add", {
    body: {
      en,
      ja: ja || undefined,
      source: "web"
    }
  });

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
