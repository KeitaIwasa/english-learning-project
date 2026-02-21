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
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!userData.user || !session?.access_token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { error } = await supabase.functions.invoke("flashcards-add", {
    body: {
      en,
      ja: ja || undefined,
      source: "web"
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    console.error("flashcards-add invoke failed:", error.message);
  }

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
