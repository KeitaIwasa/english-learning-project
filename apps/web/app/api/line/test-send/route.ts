import { NextResponse } from "next/server";
import { enqueueLineDelivery, getLatestReadingPassageForUser, getReadingPassageForDate } from "@/lib/line-delivery-service";
import { lineTestSendSchema } from "@/lib/shared";
import { jsonError, parseJsonRequest, requireRouteUserWithAdmin } from "@/lib/server/route-helpers";

export async function POST(request: Request) {
  try {
    const auth = await requireRouteUserWithAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseJsonRequest(request, lineTestSendSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const passage = parsed.data.date
      ? await getReadingPassageForDate({
          adminClient: auth.adminClient,
          userId: auth.user.id,
          targetDate: parsed.data.date
        })
      : await getLatestReadingPassageForUser({
          adminClient: auth.adminClient,
          userId: auth.user.id
        });

    if (!passage?.id || !passage.generated_for_date) {
      return NextResponse.json({ error: "送信できる音読文がありません。" }, { status: 404 });
    }

    const result = await enqueueLineDelivery({
      adminClient: auth.adminClient,
      userId: auth.user.id,
      targetDate: passage.generated_for_date,
      passageId: passage.id,
      triggerType: "manual",
      allowResend: true
    });

    if (!result.ok && result.conflict) {
      return NextResponse.json(
        {
          error: result.error,
          status: result.job.status,
          jobId: result.job.id
        },
        { status: 409 }
      );
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      queued: result.queued,
      reused: result.reused,
      jobId: result.job.id,
      targetDate: passage.generated_for_date
    });
  } catch (error) {
    return jsonError(error);
  }
}
