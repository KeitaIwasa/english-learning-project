import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  createAdminSupabaseClient,
  executeReadingGeneration,
  getLatestJobForDate,
  markTimedOutProcessingJobs,
  resolveTargetDate
} from "@/app/api/reading/_jobs";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const targetDate = resolveTargetDate(new URL(request.url).searchParams.get("date"));
    const adminClient = createAdminSupabaseClient();

    await markTimedOutProcessingJobs({
      adminClient,
      userId: auth.user.id,
      targetDate
    });

    const latest = await getLatestJobForDate({
      adminClient,
      userId: auth.user.id,
      targetDate
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
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const targetDate = resolveTargetDate(body?.date);
    const force = body?.force === true;
    const profileId = typeof body?.profileId === "string" ? body.profileId : undefined;

    const result = await executeReadingGeneration({
      adminClient: createAdminSupabaseClient(),
      userId: auth.user.id,
      targetDate,
      triggerType: "manual",
      force,
      profileId
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
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
