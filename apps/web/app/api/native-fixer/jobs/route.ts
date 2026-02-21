import { NextResponse } from "next/server";
import { speechFixJobCreateSchema } from "@/lib/schemas";
import { createAdminSupabaseClient, createStoragePath, requireAuthUser, type SpeechFixJob } from "../_utils";

const TEMP_BUCKET = "speech-fixer-temp";

export async function GET() {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("speech_fix_jobs")
    .select("id, file_name, custom_title, status, created_at, completed_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: (data ?? []).map((item) => ({
      id: item.id,
      fileName: item.file_name,
      customTitle: item.custom_title,
      status: item.status,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      completedAt: item.completed_at
    }))
  });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = speechFixJobCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { fileName, fileSize, mimeType } = parsed.data;
  const { data: created, error: createError } = await supabase
    .from("speech_fix_jobs")
    .insert({
      user_id: user.id,
      file_name: fileName,
      file_size: fileSize,
      mime_type: mimeType,
      status: "uploaded"
    })
    .select("*")
    .single();

  if (createError || !created) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create job" }, { status: 500 });
  }

  const createdJob = created as SpeechFixJob;
  const uploadPath = createStoragePath({
    userId: user.id,
    jobId: createdJob.id,
    fileName
  });

  const { error: pathSaveError } = await supabase
    .from("speech_fix_jobs")
    .update({
      storage_path: uploadPath
    })
    .eq("id", createdJob.id);

  if (pathSaveError) {
    return NextResponse.json({ error: pathSaveError.message }, { status: 500 });
  }

  const adminClient = createAdminSupabaseClient();
  const uploadSignResult = await adminClient.storage.from(TEMP_BUCKET).createSignedUploadUrl(uploadPath);
  if (uploadSignResult.error || !uploadSignResult.data?.signedUrl) {
    return NextResponse.json(
      { error: uploadSignResult.error?.message ?? "Failed to create signed upload URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    jobId: createdJob.id,
    uploadPath,
    signedUploadUrl: uploadSignResult.data.signedUrl,
    token: uploadSignResult.data.token
  });
}
