import { NextResponse } from "next/server";
import { buildLineLinkInstructions, consumeLineLinkCode, getLineLinkFailureMessage } from "@/lib/line-link";
import { parseLineLinkCode, replyLineMessages, verifyLineWebhookSignature } from "@/lib/line";
import { createAdminSupabaseClient } from "@/lib/service";

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  message?: {
    type?: string;
    text?: string;
  };
  source?: {
    userId?: string;
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineWebhookSignature({ body: rawBody, signature })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody || "{}") as { events?: LineWebhookEvent[] };
  const events = Array.isArray(payload.events) ? payload.events : [];
  const adminClient = createAdminSupabaseClient();

  for (const event of events) {
    try {
      await handleEvent({ adminClient, event });
    } catch (error) {
      console.error("[line-webhook] failed to process event", error);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(params: {
  adminClient: ReturnType<typeof createAdminSupabaseClient>;
  event: LineWebhookEvent;
}) {
  const lineUserId = String(params.event.source?.userId ?? "").trim();
  const replyToken = String(params.event.replyToken ?? "").trim();

  if (params.event.type === "follow" && replyToken) {
    await replyLineMessages({
      replyToken,
      messages: [{ type: "text", text: buildLineLinkInstructions() }]
    });
    return;
  }

  if (params.event.type !== "message" || params.event.message?.type !== "text" || !replyToken) {
    return;
  }

  const linkCode = parseLineLinkCode(String(params.event.message?.text ?? ""));
  if (!linkCode) {
    await replyLineMessages({
      replyToken,
      messages: [{ type: "text", text: buildLineLinkInstructions() }]
    });
    return;
  }

  if (!lineUserId) {
    await replyLineMessages({
      replyToken,
      messages: [{ type: "text", text: "LINEユーザー情報を取得できませんでした。もう一度お試しください。" }]
    });
    return;
  }

  const result = await consumeLineLinkCode({
    adminClient: params.adminClient,
    code: linkCode,
    lineUserId
  });

  if (!result.ok) {
    await replyLineMessages({
      replyToken,
      messages: [{ type: "text", text: getLineLinkFailureMessage(result.error) }]
    });
    return;
  }

  await replyLineMessages({
    replyToken,
    messages: [
      {
        type: "text",
        text: result.alreadyLinked
          ? "すでにLINE連携済みです。毎朝06:00の音読文を自動送信します。"
          : "LINE連携が完了しました。毎朝06:00の音読文を自動送信します。"
      }
    ]
  });
}
