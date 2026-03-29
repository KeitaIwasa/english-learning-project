import { NextResponse } from "next/server";
import { speechFixAddFlashcardSchema } from "@/lib/schemas";
import { normalizeCorrections, requireAuthUser } from "../../../../../_utils";
import { addFlashcard } from "@/lib/flashcards";
import { createAdminSupabaseClient } from "@/lib/service";

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

  let flashcardId = "";
  let duplicated = false;
  try {
    const result = await addFlashcard({
      serviceClient: createAdminSupabaseClient(),
      userId: user.id,
      en: parsed.data.en,
      ja: parsed.data.ja || undefined,
      source: "web"
    });
    flashcardId = result.id;
    duplicated = Boolean(result.duplicated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  corrections[correctionIndex] = {
    ...target,
    addedFlashcardId: flashcardId
  };

  const { error: saveError } = await supabase
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
    duplicated
  });
}
