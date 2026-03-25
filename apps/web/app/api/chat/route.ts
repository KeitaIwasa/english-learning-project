import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { chatRouterRequestSchema } from "@/lib/schemas";
import { createAdminSupabaseClient } from "@/lib/service";
import { addFlashcard } from "@/lib/flashcards";
import { appEnv } from "@/lib/app-env";
import { generateWithGemini, streamWithGemini, type GeminiContent } from "@/lib/gemini";
import { buildAskContextTurns } from "@/lib/chat-context";

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

type ChatMode = "translate" | "ask" | "add_flashcard";
type AskStreamDonePayload = { reply: string; threadId: string };
const ASK_CONTEXT_HISTORY_TURNS = 5;
const ASK_CONTEXT_MAX_CHARS = 10000;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const before = searchParams.get("before");
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_HISTORY_LIMIT)
      : DEFAULT_HISTORY_LIMIT;

  if (before && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: "Invalid before cursor" }, { status: 400 });
  }

  let query = supabase
    .from("chat_messages")
    .select("id, thread_id, role, mode, content, created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextBefore = hasMore ? pageRows.at(-1)?.created_at ?? null : null;
  const messages = [...pageRows].reverse();

  return NextResponse.json({ messages, hasMore, nextBefore });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = chatRouterRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const serviceClient = createAdminSupabaseClient();
    const mode = parsed.data.mode as ChatMode;
    const message = String(parsed.data.message ?? "").trim();
    const chatId = parsed.data.chatId ? String(parsed.data.chatId) : null;

    if (!mode || !["translate", "ask", "add_flashcard"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (mode === "translate") {
      const threadId = await ensureThread(serviceClient, auth.user.id, chatId, message);
      return streamTranslateResponse({
        message,
        threadId,
        userId: auth.user.id,
        serviceClient
      });
    }

    if (mode === "add_flashcard") {
      const flashcard = parseFlashcardMessage(message);
      const card = await addFlashcard({
        serviceClient,
        userId: auth.user.id,
        en: flashcard.en,
        ja: flashcard.ja,
        source: "chat"
      });
      return NextResponse.json({ flashcardId: card.id, en: card.en, ja: card.ja });
    }

    const threadId = await ensureThread(serviceClient, auth.user.id, chatId, message);

    const { data: userMessage, error: userMessageError } = await serviceClient
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: auth.user.id,
        role: "user",
        mode,
        content: message
      })
      .select("id")
      .single();

    if (userMessageError) {
      throw userMessageError;
    }

    const { data: historyRows } = await serviceClient
      .from("chat_messages")
      .select("id, role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(40);

    const history = [...(historyRows ?? [])]
      .filter((row) => row.id !== userMessage.id)
      .reverse();

    const askContents = buildAskContents(history, message, ASK_CONTEXT_HISTORY_TURNS, ASK_CONTEXT_MAX_CHARS);

    return streamAskResponse({
      askContents,
      userId: auth.user.id,
      userMessageId: userMessage.id,
      threadId,
      serviceClient,
      message
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function parseFlashcardMessage(message: string): { en: string; ja?: string } {
  const [enPart, jaPart] = message.split("||").map((value) => value.trim());

  if (!enPart) {
    throw new Error("For add_flashcard mode, message must include English text.");
  }

  return {
    en: enPart,
    ja: jaPart || undefined
  };
}

function buildAskContents(
  rows: Array<{ role: string; content: string }>,
  latestMessage: string,
  maxHistoryTurns: number,
  maxChars: number
): GeminiContent[] {
  return buildAskContextTurns({
    rows,
    latestMessage,
    maxHistoryTurns,
    maxTotalChars: maxChars
  }).map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }]
  }));
}

async function ensureThread(
  serviceClient: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  chatId: string | null,
  seedMessage: string
) {
  if (chatId) {
    const { data: existing } = await serviceClient
      .from("chat_threads")
      .select("id")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return existing.id;
    }
  }

  const { data: created, error } = await serviceClient
    .from("chat_threads")
    .insert({
      user_id: userId,
      title: seedMessage.slice(0, 40)
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return created.id;
}

function deriveSignals(message: string, reply: string): Array<{ key: string; weight: number }> {
  const text = `${message}\n${reply}`.toLowerCase();
  const rules: Array<{ key: string; pattern: RegExp }> = [
    { key: "present perfect", pattern: /present perfect|have been|has been/ },
    { key: "prepositions", pattern: /preposition|in on at|for to/ },
    { key: "articles", pattern: /article|a an the/ },
    { key: "past tense", pattern: /past tense|did|went|was were/ }
  ];

  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => ({ key: rule.key, weight: 0.6 }));
}

function streamTranslateResponse(params: {
  message: string;
  threadId: string;
  userId: string;
  serviceClient: ReturnType<typeof createAdminSupabaseClient>;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (
        event: "delta" | "done" | "error",
        payload: { text: string } | AskStreamDonePayload | { message: string; threadId?: string }
      ) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      const process = async () => {
        try {
          const { data: userMessage, error: userMessageError } = await params.serviceClient
            .from("chat_messages")
            .insert({
              thread_id: params.threadId,
              user_id: params.userId,
              role: "user",
              mode: "translate",
              content: params.message
            })
            .select("id")
            .single();

          if (userMessageError || !userMessage?.id) {
            throw userMessageError ?? new Error("Failed to persist translate user message");
          }

          let answerText = "";
          for await (const chunk of streamWithGemini({
            model: appEnv.geminiFastModel(),
            instruction:
              "あなたは、英会話教師です。ユーザーが送るメッセージは以下のいずれかです。\n- 日本語の文章→自然な英語に翻訳してください。（いくつか候補を提示）\n- 英語の単語や文章→日本語に翻訳して、どのようなニュアンスになるか説明してください。英語の使い方に誤りがあったり不自然だったりする場合は、的確に指摘してください。単刀直入にシンプルに答えてください。",
            input: params.message
          })) {
            answerText += chunk;
            writeEvent("delta", { text: chunk });
          }

          const { error: assistantMessageError } = await params.serviceClient.from("chat_messages").insert({
            thread_id: params.threadId,
            user_id: params.userId,
            role: "assistant",
            mode: "translate",
            content: answerText
          });

          if (assistantMessageError) {
            throw assistantMessageError;
          }

          writeEvent("done", { reply: answerText.trim(), threadId: params.threadId });
        } catch (error) {
          console.error(error);
          writeEvent("error", { message: String(error), threadId: params.threadId });
        } finally {
          controller.close();
        }
      };

      void process();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function streamAskResponse(params: {
  askContents: GeminiContent[];
  userId: string;
  message: string;
  userMessageId: string;
  threadId: string;
  serviceClient: ReturnType<typeof createAdminSupabaseClient>;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (
        event: "delta" | "done" | "error",
        payload: { text: string } | AskStreamDonePayload | { message: string; threadId?: string }
      ) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      const process = async () => {
        try {
          let answerText = "";
          let streamError: unknown = null;

          try {
            for await (const chunk of streamWithGemini({
              model: appEnv.geminiFastModel(),
              instruction:
                "あなたは、英会話教師です。友達同士での日常会話やチャットでの英語に焦点を当ててください。シンプルな回答を心がけてください。英語の例文を示す際は、過去のチャットで使ったフレーズや文法を積極的に取り入れ、復習にもなるようにして。",
              contents: params.askContents
            })) {
              answerText += chunk;
              writeEvent("delta", { text: chunk });
            }
          } catch (error) {
            streamError = error;
            console.error(`[chat-router] streamWithGemini failed: ${String(error)}`);
          }

          if (!answerText.trim()) {
            const fallback = await generateWithGemini({
              model: appEnv.geminiFastModel(),
              instruction:
                "あなたは、英会話教師です。友達同士での日常会話やチャットでの英語に焦点を当ててください。シンプルな回答を心がけてください。英語の例文を示す際は、過去のチャットで使ったフレーズや文法を積極的に取り入れ、復習にもなるようにして。",
              contents: params.askContents
            });
            answerText = fallback.text.trim();
            if (answerText) {
              writeEvent("delta", { text: answerText });
            }
          }

          if (!answerText.trim()) {
            throw new Error(
              `[chat-router] ask response is empty after stream + fallback. threadId=${params.threadId} streamError=${String(streamError)}`
            );
          }

          const { error: assistantMessageError } = await params.serviceClient.from("chat_messages").insert({
            thread_id: params.threadId,
            user_id: params.userId,
            role: "assistant",
            mode: "ask",
            content: answerText
          });

          if (assistantMessageError) {
            throw assistantMessageError;
          }

          const signals = deriveSignals(params.message, answerText);
          if (signals.length > 0) {
            const { error: signalInsertError } = await params.serviceClient.from("chat_learning_signals").insert(
              signals.map((signal) => ({
                user_id: params.userId,
                source_message_id: params.userMessageId,
                signal_type: "grammar_or_usage",
                signal_key: signal.key,
                weight: signal.weight
              }))
            );

            if (signalInsertError) {
              console.error(signalInsertError);
            }
          }

          writeEvent("done", { reply: answerText, threadId: params.threadId });
        } catch (error) {
          console.error(error);
          writeEvent("error", { message: String(error), threadId: params.threadId });
        } finally {
          controller.close();
        }
      };

      void process();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
