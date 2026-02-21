import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { appEnv } from "../_shared/env.ts";
import { addFlashcard } from "../_shared/flashcards.ts";
import { generateWithGemini, streamWithGemini, type GeminiContent } from "../_shared/gemini.ts";

type ChatMode = "translate" | "ask" | "add_flashcard";
type AskStreamDonePayload = { reply: string; threadId: string };
const ASK_CONTEXT_MAX_MESSAGES = 10; // about 5 turns
const ASK_CONTEXT_MAX_CHARS = 3000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();

    const {
      data: { user },
      error: authError
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const mode = body?.mode as ChatMode;
    const message = String(body?.message ?? "").trim();
    const chatId = body?.chatId ? String(body.chatId) : null;

    if (!mode || !["translate", "ask", "add_flashcard"].includes(mode)) {
      return json({ error: "Invalid mode" }, 400);
    }

    if (!message) {
      return json({ error: "Message is required" }, 400);
    }

    if (mode === "translate") {
      return streamTranslateResponse({
        message
      });
    }

    if (mode === "add_flashcard") {
      const parsed = parseFlashcardMessage(message);
      const card = await addFlashcard({
        serviceClient,
        userId: user.id,
        en: parsed.en,
        ja: parsed.ja,
        source: "chat"
      });

      return json({ flashcardId: card.id, en: card.en, ja: card.ja });
    }

    const threadId = await ensureThread(serviceClient, user.id, chatId, message);

    const { data: userMessage, error: userMessageError } = await serviceClient
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: user.id,
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
    const askContents = buildAskContents(history, message, ASK_CONTEXT_MAX_MESSAGES, ASK_CONTEXT_MAX_CHARS);

    return streamAskResponse({
      askContents,
      userId: user.id,
      userMessageId: userMessage.id,
      threadId,
      serviceClient,
      message
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

function streamTranslateResponse(params: { message: string }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: "delta" | "done" | "error", payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      const process = async () => {
        try {
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

          writeEvent("done", { reply: answerText.trim() });
        } catch (error) {
          console.error(error);
          writeEvent("error", { message: String(error) });
        } finally {
          controller.close();
        }
      };

      void process();
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

async function ensureThread(serviceClient: any, userId: string, chatId: string | null, seedMessage: string) {
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
  maxMessages: number,
  maxChars: number
): GeminiContent[] {
  const turns = rows
    .map((row) => ({
      role: row.role === "assistant" ? ("model" as const) : ("user" as const),
      text: String(row.content ?? "").trim()
    }))
    .filter((turn) => turn.text.length > 0);

  turns.push({
    role: "user",
    text: latestMessage
  });

  const recent = turns.slice(-maxMessages);
  const selected: Array<{ role: "user" | "model"; text: string }> = [];
  let usedChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (!turn.text.trim()) {
      continue;
    }

    const withNewline = selected.length > 0 ? turn.text.length + 1 : turn.text.length;
    if (usedChars + withNewline <= maxChars) {
      selected.push(turn);
      usedChars += withNewline;
      continue;
    }

    if (selected.length === 0) {
      selected.push({
        role: turn.role,
        text: turn.text.slice(-maxChars)
      });
    }
    break;
  }

  const merged: Array<{ role: "user" | "model"; text: string }> = [];
  for (const turn of selected.reverse()) {
    const last = merged.at(-1);
    if (last && last.role === turn.role) {
      last.text = `${last.text}\n${turn.text}`;
      continue;
    }
    merged.push({ role: turn.role, text: turn.text });
  }

  return merged.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }]
  }));
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

function streamAskResponse(params: {
  askContents: GeminiContent[];
  userId: string;
  message: string;
  userMessageId: string;
  threadId: string;
  serviceClient: any;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (
        event: "delta" | "done" | "error",
        payload: { text: string } | AskStreamDonePayload | { message: string }
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

          // Gemini stream occasionally ends without text for ask mode.
          // Fall back to non-stream generateContent so users still get a reply.
          if (!answerText.trim()) {
            console.error(
              `[chat-router] Empty ask stream response. Falling back to generateContent. threadId=${params.threadId} streamError=${String(streamError)}`
            );
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
          writeEvent("error", { message: String(error) });
        } finally {
          controller.close();
        }
      };

      void process();
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
