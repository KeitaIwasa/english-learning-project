import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { flashcardReviewRequestSchema } from "@/lib/schemas";

async function getAuth() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!user || !session?.access_token) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    accessToken: session.access_token
  };
}

function getFunctionEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase env vars");
  }
  return { supabaseUrl, anonKey };
}

export async function GET() {
  const auth = await getAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { supabaseUrl, anonKey } = getFunctionEnv();
    const upstream = await fetch(`${supabaseUrl}/functions/v1/flashcards-review`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        apikey: anonKey
      }
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json({ error: text || "flashcards-review invocation failed" }, { status: upstream.status });
    }

    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: "Invalid JSON from flashcards-review" }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = flashcardReviewRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { supabaseUrl, anonKey } = getFunctionEnv();
    const upstream = await fetch(`${supabaseUrl}/functions/v1/flashcards-review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        apikey: anonKey
      },
      body: JSON.stringify(parsed.data)
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json({ error: text || "flashcards-review invocation failed" }, { status: upstream.status });
    }

    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: "Invalid JSON from flashcards-review" }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
