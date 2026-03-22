import { NextResponse } from "next/server";
import { speechFixJobCreateSchema } from "@/lib/schemas";
import { buildGcsV4SignedPutUrl, parseGoogleServiceAccount } from "@/lib/google-cloud";
import { createGcsObjectName, requireAuthUser, type SpeechFixJob } from "../_utils";

const GCS_SIGN_EXPIRES_SECONDS = 15 * 60;

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
  try {
    const { supabase, user } = await requireAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = speechFixJobCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { fileName, fileSize, mimeType } = parsed.data;
    const bucket = normalizeGcsField(process.env.GCS_TEMP_BUCKET);
    const serviceAccountJson = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "").trim();
    if (!bucket || !serviceAccountJson) {
      return NextResponse.json({ error: "Missing GCS_TEMP_BUCKET or GOOGLE_APPLICATION_CREDENTIALS_JSON" }, { status: 500 });
    }

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
    const gcsObjectName = createGcsObjectName({
      userId: user.id,
      jobId: createdJob.id,
      fileName
    });

    const { error: pathSaveError } = await supabase
      .from("speech_fix_jobs")
      .update({
        gcs_bucket: bucket,
        gcs_object_name: gcsObjectName
      })
      .eq("id", createdJob.id);

    if (pathSaveError) {
      return NextResponse.json({ error: pathSaveError.message }, { status: 500 });
    }

    const serviceAccount = parseGoogleServiceAccount(serviceAccountJson);
    const gcsSignedUploadUrl = buildGcsV4SignedPutUrl({
      serviceAccount,
      bucket,
      objectName: gcsObjectName,
      contentType: mimeType,
      expiresSeconds: GCS_SIGN_EXPIRES_SECONDS
    });

    return NextResponse.json({
      jobId: createdJob.id,
      gcsObjectName,
      gcsSignedUploadUrl,
      requiredHeaders: {
        "Content-Type": mimeType
      }
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function normalizeGcsField(value: unknown) {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}
