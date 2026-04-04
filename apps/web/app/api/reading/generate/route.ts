import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/service";
import { enqueueReadingGeneration, getReadingGenerationStatus } from "@/lib/reading-generate-service";
import { jsonError, requireRouteUser } from "@/lib/server/route-helpers";

export async function GET(request: Request) {
  try {
    const auth = await requireRouteUser();
    if (!auth.ok) {
      return auth.response;
    }

    const { latest, targetDate } = await getReadingGenerationStatus({
      adminClient: createAdminSupabaseClient(),
      userId: auth.user.id,
      rawDate: new URL(request.url).searchParams.get("date")
    });

    if (!latest) {
      return NextResponse.json({
        jobId: null,
        status: null,
        triggerType: null,
        error: null,
        targetDate
      });
    }

    return NextResponse.json({
      jobId: latest.id,
      status: latest.status,
      triggerType: latest.trigger_type,
      error: latest.error_message,
      targetDate
    });
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

    const body = await request.json().catch(() => ({}));
    const { result, targetDate } = await enqueueReadingGeneration({
      adminClient: createAdminSupabaseClient(),
      userId: auth.user.id,
      rawDate: body?.date,
      force: body?.force === true,
      profileId: typeof body?.profileId === "string" ? body.profileId : undefined
    });

    if (!result.ok && result.conflict) {
      return NextResponse.json(
        {
          error: result.error,
          jobId: result.job.id,
          status: result.job.status,
          targetDate
        },
        { status: 409 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          jobId: result.job.id,
          status: result.job.status,
          targetDate
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ...(result.payload ?? {}),
      jobId: result.job.id,
      status: result.job.status,
      targetDate
    });
  } catch (error) {
    return jsonError(error);
  }
}
