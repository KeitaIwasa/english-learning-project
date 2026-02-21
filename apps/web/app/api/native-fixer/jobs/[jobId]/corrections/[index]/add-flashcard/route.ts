import { NextResponse } from "next/server";
import { speechFixAddFlashcardSchema } from "@/lib/schemas";
import { createAdminSupabaseClient, normalizeCorrections, requireAuthUser } from "../../../../../_utils";

type RouteContext = {
  params: Promise<{ jobId: string; index: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = speechFixAddFlashcardSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { jobId, index: indexText } = await context.params;
  const correctionIndex = Number(indexText);
  if (!Number.isInteger(correctionIndex) || correctionIndex < 0) {
    return NextResponse.json({ error: "Invalid correction index" }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("speech_fix_jobs")
    .select("id, corrections_json")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const corrections = normalizeCorrections(job.corrections_json);
  const target = corrections[correctionIndex];
  if (!target) {
    return NextResponse.json({ error: "Correction not found" }, { status: 404 });
  }
  if (target.addedFlashcardId) {
    return NextResponse.json({ error: "Already added", flashcardId: target.addedFlashcardId }, { status: 409 });
  }

  const admin = createAdminSupabaseClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Missing service env vars" }, { status: 500 });
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/flashcards-add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey
    },
    body: JSON.stringify({
      userId: user.id,
      en: parsed.data.en,
      ja: parsed.data.ja || undefined,
      source: "web"
    })
  });

  const rawText = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json({ error: rawText || "flashcards-add failed" }, { status: upstream.status });
  }

  let json: { id?: string; duplicated?: boolean };
  try {
    json = JSON.parse(rawText) as { id?: string; duplicated?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid flashcards-add response" }, { status: 502 });
  }

  const flashcardId = typeof json.id === "string" ? json.id : "";
  if (!flashcardId) {
    return NextResponse.json({ error: "flashcards-add did not return id" }, { status: 502 });
  }

  corrections[correctionIndex] = {
    ...target,
    addedFlashcardId: flashcardId
  };

  const { error: saveError } = await admin
    .from("speech_fix_jobs")
    .update({
      corrections_json: corrections
    })
    .eq("id", jobId)
    .eq("user_id", user.id);

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    flashcardId,
    duplicated: Boolean(json.duplicated)
  });
}
