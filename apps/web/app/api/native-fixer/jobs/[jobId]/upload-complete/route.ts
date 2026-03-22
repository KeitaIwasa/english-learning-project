import { NextResponse } from "next/server";
import { requireAuthUser } from "../../../_utils";
import { checkGcsObjectExists, getGoogleAccessToken, parseGoogleServiceAccount } from "@/lib/google-cloud";
import { getServiceEnv } from "@/lib/service";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const { data: job, error: findError } = await supabase
      .from("speech_fix_jobs")
      .select("id, status, gcs_bucket, gcs_object_name, stats_json")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .eq("status", "uploaded")
      .maybeSingle();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "Not found or invalid state" }, { status: 409 });
    }

    const gcsBucket = normalizeGcsField(job.gcs_bucket);
    const gcsObjectName = normalizeGcsField(job.gcs_object_name);
    if (!gcsBucket || !gcsObjectName) {
      return NextResponse.json({ error: "GCS object info missing on job" }, { status: 500 });
    }

    const serviceAccountRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "").trim();
    if (!serviceAccountRaw) {
      return NextResponse.json({ error: "Missing GOOGLE_APPLICATION_CREDENTIALS_JSON" }, { status: 500 });
    }
    const serviceAccount = parseGoogleServiceAccount(serviceAccountRaw);
    const accessToken = await getGoogleAccessToken({
      serviceAccount,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const objectState = await checkGcsObjectExists({
      accessToken,
      bucket: gcsBucket,
      objectName: gcsObjectName
    });
    if (!objectState.exists) {
      return NextResponse.json({ error: "Uploaded object not found in GCS" }, { status: 409 });
    }

    const queuedAt = new Date().toISOString();
    const baseStats = job.stats_json && typeof job.stats_json === "object" && !Array.isArray(job.stats_json) ? job.stats_json : {};
    const { data, error } = await supabase
      .from("speech_fix_jobs")
      .update({
        status: "queued",
        error_message: null,
        gcs_upload_completed_at: queuedAt,
        stats_json: {
          ...baseStats,
          queuedAt,
          uploadBytes: objectState.size ?? null,
          uploadContentType: objectState.contentType || null,
          gcsBucket,
          gcsObjectName
        }
      })
      .eq("id", jobId)
      .eq("user_id", user.id)
      .eq("status", "uploaded")
      .select("id, status")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found or invalid state" }, { status: 409 });
    }

    void triggerSpeechFixerOnce();

    return NextResponse.json({ ok: true, id: data.id, status: data.status });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function triggerSpeechFixerOnce() {
  try {
    const { supabaseUrl, serviceRoleKey } = getServiceEnv();
    await fetch(`${supabaseUrl}/functions/v1/speech-fixer-process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey
      },
      body: JSON.stringify({ limit: 1 }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    console.error(`[native-fixer] failed to trigger speech-fixer-process immediately: ${String(error)}`);
  }
}

function normalizeGcsField(value: unknown) {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim();
}
