import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appEnv } from "@/lib/app-env";

type LineTextMessage = {
  type: "text";
  text: string;
};

type LineAudioMessage = {
  type: "audio";
  originalContentUrl: string;
  duration: number;
};

export type LineSendMessage = LineTextMessage | LineAudioMessage;

type LineReplyResponse = {
  requestId: string | null;
};

type LinePushResponse = {
  requestId: string | null;
};

export class LineApiError extends Error {
  status: number;
  retriable: boolean;
  requestId: string | null;

  constructor(params: { message: string; status: number; retriable: boolean; requestId?: string | null }) {
    super(params.message);
    this.name = "LineApiError";
    this.status = params.status;
    this.retriable = params.retriable;
    this.requestId = params.requestId ?? null;
  }
}

export function parseLineLinkCode(text: string) {
  const trimmed = String(text ?? "").trim();
  const matched = trimmed.match(/^link\s+([A-Z0-9]{6,12})$/i);
  if (!matched) {
    return null;
  }
  return matched[1].toUpperCase();
}

export function createLineLinkCode() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function verifyLineWebhookSignature(params: {
  body: string;
  signature: string | null;
  channelSecret?: string;
}) {
  const signature = String(params.signature ?? "").trim();
  if (!signature) {
    return false;
  }

  const mac = createHmac("sha256", params.channelSecret ?? appEnv.lineChannelSecret()).update(params.body).digest("base64");
  const actual = Buffer.from(mac);
  const expected = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function replyLineMessages(params: {
  replyToken: string;
  messages: LineSendMessage[];
}) {
  return await sendLineRequest<LineReplyResponse>({
    endpoint: "https://api.line.me/v2/bot/message/reply",
    body: {
      replyToken: params.replyToken,
      messages: params.messages
    }
  });
}

export async function pushLineMessages(params: {
  to: string;
  messages: LineSendMessage[];
  retryKey?: string;
}) {
  return await sendLineRequest<LinePushResponse>({
    endpoint: "https://api.line.me/v2/bot/message/push",
    body: {
      to: params.to,
      messages: params.messages
    },
    retryKey: params.retryKey
  });
}

async function sendLineRequest<T>(params: {
  endpoint: string;
  body: Record<string, unknown>;
  retryKey?: string;
}): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${appEnv.lineChannelAccessToken()}`
  };

  if (params.retryKey) {
    headers["X-Line-Retry-Key"] = params.retryKey;
  }

  const response = await fetch(params.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body)
  });
  const requestId = response.headers.get("x-line-request-id");

  if (!response.ok) {
    const text = await response.text();
    throw new LineApiError({
      message: `LINE API error: ${response.status} ${text}`,
      status: response.status,
      retriable: response.status === 429 || response.status >= 500,
      requestId
    });
  }

  const json = (await response.json().catch(() => ({}))) as T;
  return {
    ...json,
    requestId
  };
}
