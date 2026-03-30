import { buildAskContextTurns, type ChatMode } from "@english/shared";
import { createAdminSupabaseClient } from "@/lib/service";
import type { GeminiContent } from "@/lib/gemini";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

export function resolveHistoryLimit(rawLimit: string | null) {
  const limitParam = Number.parseInt(rawLimit ?? "", 10);
  return Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT;
}

export async function getChatHistory(params: {
  supabase: AppSupabaseClient;
  userId: string;
  limit: number;
  before: string | null;
}) {
  let query = params.supabase
    .from("chat_messages")
    .select("id, thread_id, role, mode, content, created_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(params.limit + 1);

  if (params.before) {
    query = query.lt("created_at", params.before);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  return {
    messages: [...pageRows].reverse(),
    hasMore,
    nextBefore: hasMore ? pageRows.at(-1)?.created_at ?? null : null
  };
}

export async function ensureChatThread(params: {
  serviceClient: AppSupabaseClient;
  userId: string;
  chatId: string | null;
  seedMessage: string;
}) {
  if (params.chatId) {
    const { data: existing } = await params.serviceClient
      .from("chat_threads")
      .select("id")
      .eq("id", params.chatId)
      .eq("user_id", params.userId)
      .maybeSingle();

    if (existing) {
      return existing.id;
    }
  }

  const { data: created, error } = await params.serviceClient
    .from("chat_threads")
    .insert({
      user_id: params.userId,
      title: params.seedMessage.slice(0, 40)
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return created.id;
}

export function parseChatFlashcardMessage(message: string): { en: string; ja?: string } {
  const [enPart, jaPart] = message.split("||").map((value) => value.trim());

  if (!enPart) {
    throw new Error("For add_flashcard mode, message must include English text.");
  }

  return {
    en: enPart,
    ja: jaPart || undefined
  };
}

export async function createAskContext(params: {
  serviceClient: AppSupabaseClient;
  userId: string;
  threadId: string;
  mode: ChatMode;
  message: string;
  maxHistoryTurns: number;
  maxChars: number;
}) {
  const { data: userMessage, error: userMessageError } = await params.serviceClient
    .from("chat_messages")
    .insert({
      thread_id: params.threadId,
      user_id: params.userId,
      role: "user",
      mode: params.mode,
      content: params.message
    })
    .select("id")
    .single();

  if (userMessageError) {
    throw userMessageError;
  }

  const { data: historyRows } = await params.serviceClient
    .from("chat_messages")
    .select("id, role, content")
    .eq("thread_id", params.threadId)
    .order("created_at", { ascending: false })
    .limit(40);

  const history = [...(historyRows ?? [])].filter((row) => row.id !== userMessage.id).reverse();

  return {
    userMessageId: userMessage.id,
    askContents: buildAskContextTurns({
      rows: history,
      latestMessage: params.message,
      maxHistoryTurns: params.maxHistoryTurns,
      maxTotalChars: params.maxChars
    }).map(
      (turn) =>
        ({
          role: turn.role,
          parts: [{ text: turn.text }]
        }) satisfies GeminiContent
    )
  };
}
