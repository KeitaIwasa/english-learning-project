import { NextResponse } from "next/server";
import { speechFixJobTitleUpdateSchema } from "@/lib/schemas";
import { normalizeCorrections, requireAuthUser } from "../../_utils";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const { data, error } = await supabase
    .from("speech_fix_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    item: {
      id: data.id,
      fileName: data.file_name,
      customTitle: data.custom_title,
      fileSize: data.file_size,
      mimeType: data.mime_type,
      status: data.status,
      transcriptFull: data.transcript_full,
      corrections: normalizeCorrections(data.corrections_json),
      errorMessage: data.error_message,
      stats: data.stats_json,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      completedAt: data.completed_at
    }
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const parsed = speechFixJobTitleUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const customTitle = parsed.data.customTitle || null;
  const { data, error } = await supabase
    .from("speech_fix_jobs")
    .update({
      custom_title: customTitle
    })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .select("id, custom_title")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id, customTitle: data.custom_title });
}
