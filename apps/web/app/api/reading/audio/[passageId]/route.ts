import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type RouteContext = {
  params: Promise<{ passageId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { passageId } = await context.params;
    if (!passageId) {
      return NextResponse.json({ error: "Missing passageId" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("reading_passages")
      .select("audio_base64, audio_mime_type")
      .eq("id", passageId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.audio_base64) {
      return NextResponse.json({ error: "Audio not found" }, { status: 404 });
    }

    const audioBytes = Buffer.from(data.audio_base64, "base64");
    return new Response(audioBytes, {
      status: 200,
      headers: {
        "Content-Type": data.audio_mime_type ?? "audio/wav",
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
