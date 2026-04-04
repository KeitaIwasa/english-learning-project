import { NextResponse } from "next/server";
import { chatRouterRequestSchema } from "@/lib/shared";
import {
  createAskContext,
  ensureChatThread,
  getChatHistory,
  parseChatFlashcardMessage,
  resolveHistoryLimit
} from "@/lib/chat-service";
import { createAdminSupabaseClient } from "@/lib/service";
import { addFlashcard } from "@/lib/flashcards";
import { appEnv } from "@/lib/app-env";
import { generateWithGemini, streamWithGemini, type GeminiContent } from "@/lib/gemini";
import { jsonError, parseJsonRequest, requireRouteUser } from "@/lib/server/route-helpers";

type AskStreamDonePayload = { reply: string; threadId: string };
const ASK_CONTEXT_HISTORY_TURNS = 5;
const ASK_CONTEXT_MAX_CHARS = 10000;

export async function GET(request: Request) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const before = searchParams.get("before");
  const limit = resolveHistoryLimit(searchParams.get("limit"));

  if (before && Number.isNaN(Date.parse(before))) {
    return jsonError("Invalid before cursor", 400);
  }

  try {
    return NextResponse.json(
      await getChatHistory({
        supabase: auth.supabase,
        userId: auth.user.id,
        limit,
        before
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

    const parsed = await parseJsonRequest(request, chatRouterRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const serviceClient = createAdminSupabaseClient();
    const mode = parsed.data.mode;
    const message = String(parsed.data.message ?? "").trim();
    const chatId = parsed.data.chatId ? String(parsed.data.chatId) : null;

    if (!mode || !["translate", "ask", "add_flashcard"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (mode === "translate") {
      const threadId = await ensureChatThread({
        serviceClient,
        userId: auth.user.id,
        chatId,
        seedMessage: message
      });
      return streamTranslateResponse({
        message,
        threadId,
        userId: auth.user.id,
        serviceClient
      });
    }

    if (mode === "add_flashcard") {
      const flashcard = parseChatFlashcardMessage(message);
      const card = await addFlashcard({
        serviceClient,
        userId: auth.user.id,
        en: flashcard.en,
        ja: flashcard.ja,
        source: "chat"
      });
      return NextResponse.json({ flashcardId: card.id, en: card.en, ja: card.ja });
    }

    const threadId = await ensureChatThread({
      serviceClient,
      userId: auth.user.id,
      chatId,
      seedMessage: message
    });
    const { askContents, userMessageId } = await createAskContext({
      serviceClient,
      userId: auth.user.id,
      threadId,
      mode,
      message,
      maxHistoryTurns: ASK_CONTEXT_HISTORY_TURNS,
      maxChars: ASK_CONTEXT_MAX_CHARS
    });

    return streamAskResponse({
      askContents,
      userId: auth.user.id,
      userMessageId,
      threadId,
      serviceClient,
      message
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
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
