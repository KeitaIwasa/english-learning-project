import { NextResponse } from "next/server";
import { speechFixJobCreateSchema } from "@english/shared";
import { createSpeechFixJob, listSpeechFixJobs } from "@/lib/native-fixer-jobs";
import { jsonError, parseJsonRequest, requireRouteUser } from "@/lib/server/route-helpers";

export async function GET() {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(
      await listSpeechFixJobs({
        supabase: auth.supabase,
        userId: auth.user.id
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRouteUser();
    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseJsonRequest(request, speechFixJobCreateSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    return NextResponse.json(
      await createSpeechFixJob({
        supabase: auth.supabase,
        userId: auth.user.id,
        ...parsed.data
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
