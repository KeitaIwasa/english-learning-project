import { NextResponse } from "next/server";
import { completeUploadedSpeechFixJob } from "@/lib/native-fixer-jobs";
import { jsonError, requireRouteUser } from "@/lib/server/route-helpers";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const auth = await requireRouteUser();
    if (!auth.ok) {
      return auth.response;
    }

    const { jobId } = await context.params;
    const result = await completeUploadedSpeechFixJob({
      supabase: auth.supabase,
      userId: auth.user.id,
      jobId
    });
    if (!result.ok) {
      return jsonError(result.error, result.status);
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
