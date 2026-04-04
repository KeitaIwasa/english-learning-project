import { NextResponse } from "next/server";
import { speechFixAddFlashcardSchema } from "@/lib/shared";
import { addSpeechFixCorrectionFlashcard } from "@/lib/native-fixer-jobs";
import { jsonError, parseJsonRequest, requireRouteUserWithAdmin } from "@/lib/server/route-helpers";

type RouteContext = {
  params: Promise<{ jobId: string; index: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireRouteUserWithAdmin();
  if (!auth.ok) {
    return auth.response;
  }
  const parsed = await parseJsonRequest(request, speechFixAddFlashcardSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { jobId, index: indexText } = await context.params;
  const correctionIndex = Number(indexText);
  if (!Number.isInteger(correctionIndex) || correctionIndex < 0) {
    return jsonError("Invalid correction index", 400);
  }

  try {
    const result = await addSpeechFixCorrectionFlashcard({
      supabase: auth.supabase,
      adminClient: auth.adminClient,
      userId: auth.user.id,
      jobId,
      correctionIndex,
      en: parsed.data.en,
      ja: parsed.data.ja || undefined
    });
    if (!result.ok) {
      return NextResponse.json(
        result.flashcardId ? { error: result.error, flashcardId: result.flashcardId } : { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
