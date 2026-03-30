import { NextResponse } from "next/server";
import { flashcardReviewRequestSchema } from "@/lib/shared";
import { loadReviewQueue, submitFlashcardReview } from "@/lib/flashcards-review-service";
import { jsonError, parseJsonRequest, requireRouteUserWithAdmin } from "@/lib/server/route-helpers";

export async function GET() {
  const auth = await requireRouteUserWithAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(
      await loadReviewQueue({
        serviceClient: auth.adminClient,
        userId: auth.user.id
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireRouteUserWithAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const parsed = await parseJsonRequest(request, flashcardReviewRequestSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    return NextResponse.json(
      await submitFlashcardReview({
        serviceClient: auth.adminClient,
        userId: auth.user.id,
        ...parsed.data
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
