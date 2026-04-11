import { NextResponse } from "next/server";
import { verifyWorkerToken } from "@/lib/cloud-tasks";
import { enqueueLineDelivery } from "@/lib/line-delivery-service";
import { createAdminSupabaseClient } from "@/lib/service";
import { runReadingGenerateDaily } from "@/lib/reading-generate";

type Payload = {
  jobId: string;
  userId: string;
  targetDate: string;
  force?: boolean;
  profileId?: string;
};

export async function POST(request: Request) {
  if (!verifyWorkerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<Payload>;
  const jobId = String(payload.jobId ?? "").trim();
  const userId = String(payload.userId ?? "").trim();
  const targetDate = String(payload.targetDate ?? "").trim();
  const force = payload.force === true;

  if (!jobId || !userId || !targetDate) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  const claim = await admin
    .from("reading_generation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      error_message: null
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "queued")
    .select("id, status")
    .maybeSingle();

  if (claim.error) {
    return NextResponse.json({ error: claim.error.message }, { status: 500 });
  }

  if (!claim.data) {
    return NextResponse.json({ ok: true, skipped: true, reason: "job not active" });
  }

  try {
    const result = await runReadingGenerateDaily({
      serviceClient: admin,
      userId,
      targetDate,
      forceRegenerate: force
    });

    let lineDelivery: {
      queued: boolean;
      error?: string;
      skipped?: boolean;
    } | null = null;

    if (result.passageId) {
      try {
        const queued = await enqueueLineDelivery({
          adminClient: admin,
          userId,
          targetDate,
          passageId: result.passageId,
          triggerType: "auto",
          allowResend: false
        });

        if (queued.ok) {
          lineDelivery = {
            queued: queued.queued
          };
        } else {
          lineDelivery = {
            queued: false,
            skipped: queued.status === 409,
            error: queued.error
          };
        }
      } catch (lineError) {
        console.error("[reading-generate-worker] failed to enqueue line delivery", lineError);
        lineDelivery = {
          queued: false,
          error: String(lineError)
        };
      }
    }

    const { error: updateError } = await admin
      .from("reading_generation_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        error_message: null
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ ok: true, jobId, result, lineDelivery });
  } catch (error) {
    await admin
      .from("reading_generation_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: String(error)
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    return NextResponse.json({ ok: false, error: String(error), jobId }, { status: 500 });
  }
}
