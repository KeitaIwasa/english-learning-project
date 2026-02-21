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
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!user || !session?.access_token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error("Missing Supabase env vars for flashcards route");
    return NextResponse.redirect(new URL("/flashcards", request.url));
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/flashcards-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: anonKey
      },
      body: JSON.stringify({
        en,
        ja: ja || undefined,
        source: "web"
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("flashcards-add invocation failed:", text);
    }
  } catch (error) {
    console.error("flashcards-add request failed:", error);
  }

  return NextResponse.redirect(new URL("/flashcards", request.url));
}
