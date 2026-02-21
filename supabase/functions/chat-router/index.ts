import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { appEnv } from "../_shared/env.ts";
import { addFlashcard } from "../_shared/flashcards.ts";
import { generateWithGemini, streamWithGemini } from "../_shared/gemini.ts";

type ChatMode = "translate" | "ask" | "add_flashcard";
const ASK_CONTEXT_MAX_MESSAGES = 10; // about 5 exchanges (user+assistant)
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
      const translated = await generateWithGemini({
        model: appEnv.geminiFastModel(),
        instruction:
          "You are a translation engine. Detect if input is Japanese or English. Translate to the opposite language. Output translation only.",
        input: message
      });

      return json({ translatedText: translated.text.trim() });
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
    const historyText = buildAskContext(history, ASK_CONTEXT_MAX_MESSAGES, ASK_CONTEXT_MAX_CHARS);

    return streamAskResponse({
      historyText,
      message,
      userId: user.id,
      userMessageId: userMessage.id,
      threadId,
      serviceClient
    });
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

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

function buildAskContext(
  rows: Array<{ role: string; content: string }>,
  maxMessages: number,
  maxChars: number
): string {
  const recent = rows.slice(-maxMessages);
  const selected: string[] = [];
  let usedChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const line = `${recent[index].role}: ${String(recent[index].content ?? "").trim()}`;
    if (!line.trim()) {
      continue;
    }

    const withNewline = selected.length > 0 ? line.length + 1 : line.length;
    if (usedChars + withNewline <= maxChars) {
      selected.push(line);
      usedChars += withNewline;
      continue;
    }

    if (selected.length === 0) {
      selected.push(line.slice(0, maxChars));
    }
    break;
  }

  return selected.reverse().join("\n");
}

function parseStructuredAsk(text: string): {
  reply: string;
  corrections: string[];
  reviewHints: string[];
  signals: Array<{ key: string; weight: number }>;
} {
  try {
    const parsed: unknown = JSON.parse(text);
    const json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      reply: String(json.reply ?? ""),
      corrections: Array.isArray(json.corrections) ? json.corrections.map(String) : [],
      reviewHints: Array.isArray(json.reviewHints) ? json.reviewHints.map(String) : [],
      signals: Array.isArray(json.signals)
        ? json.signals
            .map((raw: unknown) => {
              const signal = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
              return { key: String(signal.key ?? ""), weight: Number(signal.weight ?? 0.5) };
            })
            .filter((s: { key: string; weight: number }) => s.key)
        : []
    };
  } catch {
    return {
      reply: text,
      corrections: [],
      reviewHints: [],
      signals: []
    };
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

function streamAskResponse(params: {
  historyText: string;
  message: string;
  userId: string;
  userMessageId: string;
  threadId: string;
  serviceClient: any;
}) {
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
              "You are an English tutor. Return strict JSON: {\"reply\": string, \"corrections\": string[], \"reviewHints\": string[], \"signals\": [{\"key\": string, \"weight\": number}]}. Use Japanese explanations for learning hints.",
            input: `Conversation history:\n${params.historyText}\n\nCurrent user message:\n${params.message}`,
            responseMimeType: "application/json"
          })) {
            answerText += chunk;
            writeEvent("delta", { text: chunk });
          }

          const structured = parseStructuredAsk(answerText);
          const { error: assistantMessageError } = await params.serviceClient.from("chat_messages").insert({
            thread_id: params.threadId,
            user_id: params.userId,
            role: "assistant",
            mode: "ask",
            content: structured.reply
          });

          if (assistantMessageError) {
            throw assistantMessageError;
          }

          const signals =
            structured.signals.length > 0 ? structured.signals : deriveSignals(params.message, structured.reply);
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

          writeEvent("done", {
            reply: structured.reply,
            corrections: structured.corrections,
            reviewHints: structured.reviewHints
          });
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
