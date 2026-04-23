import { NextResponse } from "next/server";
import { enqueueWorkerTask, verifyWorkerToken } from "@/lib/cloud-tasks";
import { deliverReadingToLine, LINE_DELIVERY_RETRY_DELAYS_SECONDS, LineDeliveryError, MAX_LINE_DELIVERY_RETRIES } from "@/lib/line-delivery";
import { createAdminSupabaseClient } from "@/lib/service";

type Payload = {
  jobId: string;
  userId: string;
  targetDate: string;
};

export async function POST(request: Request) {
  if (!verifyWorkerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<Payload>;
  const jobId = String(payload.jobId ?? "").trim();
  const userId = String(payload.userId ?? "").trim();
  const targetDate = String(payload.targetDate ?? "").trim();

  if (!jobId || !userId || !targetDate) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const claim = await admin
    .from("line_delivery_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      error_message: null
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "queued")
    .select("id, retry_count")
    .maybeSingle();

  if (claim.error) {
    return NextResponse.json({ error: claim.error.message }, { status: 500 });
  }

  if (!claim.data) {
    return NextResponse.json({ ok: true, skipped: true, reason: "job not active" });
  }

  try {
    const result = await deliverReadingToLine({
      adminClient: admin,
      jobId,
      userId
    });

    const completedAt = new Date().toISOString();
    const [jobUpdate, profileUpdate] = await Promise.all([
      admin
        .from("line_delivery_jobs")
        .update({
          status: "completed",
          completed_at: completedAt,
          line_request_id: result.requestId,
          payload_json: result.payload,
          error_message: null
        })
        .eq("id", jobId)
        .eq("user_id", userId),
      admin
        .from("profiles")
        .update({ line_last_delivery_at: completedAt })
        .eq("user_id", userId)
    ]);

    if (jobUpdate.error) {
      throw jobUpdate.error;
    }
    if (profileUpdate.error) {
      throw profileUpdate.error;
    }

    return NextResponse.json({ ok: true, jobId, requestId: result.requestId });
  } catch (error) {
    const retryCount = Number(claim.data.retry_count ?? 0);
    if (error instanceof LineDeliveryError && error.retriable && retryCount < MAX_LINE_DELIVERY_RETRIES) {
      const nextRetryCount = retryCount + 1;
      const delaySeconds =
        LINE_DELIVERY_RETRY_DELAYS_SECONDS[Math.min(retryCount, LINE_DELIVERY_RETRY_DELAYS_SECONDS.length - 1)] ?? 300;

      const reset = await admin
        .from("line_delivery_jobs")
        .update({
          status: "queued",
          retry_count: nextRetryCount,
          started_at: null,
          completed_at: null,
          line_request_id: error.requestId,
          error_message: error.message
        })
        .eq("id", jobId)
        .eq("user_id", userId);

      if (reset.error) {
        return NextResponse.json({ ok: false, error: reset.error.message, jobId }, { status: 500 });
      }

      await enqueueWorkerTask({
        kind: "line_delivery",
        payload: { jobId, userId, targetDate },
        delaySeconds
      });

      return NextResponse.json({
        ok: true,
        retried: true,
        jobId,
        retryCount: nextRetryCount,
        delaySeconds
      });
    }

    await admin
      .from("line_delivery_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        line_request_id: error instanceof LineDeliveryError ? error.requestId : null,
        error_message: String(error)
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    return NextResponse.json({ ok: false, error: String(error), jobId }, { status: 500 });
  }
}
