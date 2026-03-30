import { NextResponse } from "next/server";
import { speechFixJobTitleUpdateSchema } from "@english/shared";
import { getSpeechFixJobDetail, updateSpeechFixJobTitle } from "@/lib/native-fixer-jobs";
import { jsonError, parseJsonRequest, requireRouteUser } from "@/lib/server/route-helpers";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { jobId } = await context.params;
  try {
    const result = await getSpeechFixJobDetail({
      supabase: auth.supabase,
      userId: auth.user.id,
      jobId
    });
    if (!result) {
      return jsonError("Not found", 404);
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { jobId } = await context.params;
  const parsed = await parseJsonRequest(request, speechFixJobTitleUpdateSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await updateSpeechFixJobTitle({
      supabase: auth.supabase,
      userId: auth.user.id,
      jobId,
      customTitle: parsed.data.customTitle || null
    });
    if (!result) {
      return jsonError("Not found", 404);
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
