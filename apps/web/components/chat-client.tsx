"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMode = "translate" | "ask" | "add_flashcard";

type ChatResponse = {
  reply?: string;
  flashcardId?: string;
  en?: string;
  ja?: string;
  corrections?: string[];
  reviewHints?: string[];
  error?: string;
};

type ChatHistoryMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  mode: ChatMode;
  content: string;
  created_at: string;
};

type ChatHistoryResponse = {
  messages?: ChatHistoryMessage[];
  error?: string;
};

type AskStreamDonePayload = {
  reply?: string;
  threadId?: string;
  corrections?: string[];
  reviewHints?: string[];
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode: ChatMode;
  corrections?: string[];
  reviewHints?: string[];
};

const modeLabels: Record<ChatMode, string> = {
  translate: "翻訳",
  ask: "質問・添削",
  add_flashcard: "カード追加"
};

const streamableModes: ChatMode[] = ["ask", "translate"];

export function ChatClient() {
  const [mode, setMode] = useState<ChatMode>("translate");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const scrollToTimelineBottom = useCallback(() => {
    const el = timelineRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  const placeholder = useMemo(() => {
    if (mode === "translate") {
      return "翻訳したい文を入力";
    }
    if (mode === "add_flashcard") {
      return "英語 || 日本語（日本語は任意）";
    }
    return "英語の質問や添削してほしい文を入力";
  }, [mode]);

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      try {
        const res = await fetch("/api/chat", { method: "GET" });
        const json = (await res.json()) as ChatHistoryResponse;
        if (!active) {
          return;
        }
        if (!res.ok) {
          setMessages([]);
          return;
        }

        const history: UiMessage[] = (json.messages ?? [])
          .filter((item): item is ChatHistoryMessage & { role: "user" | "assistant" } => {
            return item.role === "user" || item.role === "assistant";
          })
          .map((item) => ({
            id: item.id,
            role: item.role,
            text: item.content,
            mode: item.mode
          }));

        setMessages(history);
        const lastThreadId = (json.messages ?? []).at(-1)?.thread_id ?? null;
        setChatId(lastThreadId);
      } catch {
        if (active) {
          setMessages([]);
          setChatId(null);
        }
      } finally {
        if (active) {
          setLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    scrollToTimelineBottom();
  }, [messages, loading, loadingHistory, scrollToTimelineBottom]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) {
      return;
    }

    const currentMode = mode;
    const userMessage: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      mode: currentMode
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setLoading(true);
    requestAnimationFrame(scrollToTimelineBottom);
    const assistantId = crypto.randomUUID();

    try {
      if (streamableModes.includes(currentMode)) {
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "", mode: currentMode }]);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          message: trimmed,
          ...(chatId ? { chatId } : {})
        })
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (streamableModes.includes(currentMode) && contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedReply = "";
        let donePayload: AskStreamDonePayload | null = null;
        let streamErrorText = "";

        const updateAssistant = (patch: Partial<UiMessage>) => {
          setMessages((prev) =>
            prev.map((item) => {
              if (item.id !== assistantId) {
                return item;
              }
              return { ...item, ...patch };
            })
          );
        };

        const consumeEventBlock = (block: string) => {
          const lines = block.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) {
            return;
          }

          const event = eventLine.slice(6).trim();
          const rawData = dataLine.slice(5).trim();
          let payload: unknown;
          try {
            payload = JSON.parse(rawData);
          } catch {
            return;
          }

          if (event === "delta") {
            const json = payload as { text?: string };
            const delta = String(json.text ?? "");
            if (!delta) {
              return;
            }
            streamedReply += delta;
            updateAssistant({ text: streamedReply });
            return;
          }

          if (event === "done") {
            donePayload = payload as AskStreamDonePayload;
            return;
          }

          if (event === "error") {
            const json = payload as { message?: string };
            streamErrorText = `エラー: ${json.message ?? "stream error"}`;
            updateAssistant({ text: streamErrorText });
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            consumeEventBlock(block);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          consumeEventBlock(buffer);
        }

        const finalized: AskStreamDonePayload = donePayload ?? {};
        const finalReply = finalized.reply ?? streamedReply ?? "";
        if (finalized.threadId) {
          setChatId(finalized.threadId);
        }
        updateAssistant({
          text: finalReply || streamErrorText || "応答を取得できませんでした。",
          corrections: currentMode === "ask" ? (finalized.corrections ?? []) : [],
          reviewHints: currentMode === "ask" ? (finalized.reviewHints ?? []) : []
        });
        return;
      }

      const json = (await res.json()) as ChatResponse;

      let assistantText = "応答を取得できませんでした。";
      if (currentMode === "add_flashcard" && json.flashcardId) {
        assistantText = `フラッシュカードに追加しました。\nEN: ${json.en ?? "-"}\nJA: ${json.ja ?? "-"}`;
      } else if (json.reply) {
        assistantText = json.reply;
      } else if (json.error) {
        assistantText = `エラー: ${json.error}`;
      }

      const assistantMessage: UiMessage = {
        id: streamableModes.includes(currentMode) ? assistantId : crypto.randomUUID(),
        role: "assistant",
        text: assistantText,
        mode: currentMode,
        corrections: json.corrections,
        reviewHints: json.reviewHints
      };

      setMessages((prev) => {
        if (!streamableModes.includes(currentMode)) {
          return [...prev, assistantMessage];
        }
        return prev.map((item) => (item.id === assistantId ? assistantMessage : item));
      });
    } catch (error) {
      setMessages((prev) => {
        if (!streamableModes.includes(currentMode)) {
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: `通信エラー: ${String(error)}`,
              mode: currentMode
            }
          ];
        }
        return prev.map((item) =>
          item.id === assistantId ? { ...item, text: `通信エラー: ${String(error)}` } : item
        );
      });
    } finally {
      setLoading(false);
      requestAnimationFrame(scrollToTimelineBottom);
    }
  };

  return (
    <section className="panel chat-shell">
      <div ref={timelineRef} className="chat-timeline">
        {loadingHistory ? (
          <p className="muted">履歴を読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="muted">質問を送るとここに会話が表示されます。</p>
        ) : (
          messages.map((item) => (
            <article key={item.id} className={item.role === "user" ? "bubble user" : "bubble assistant"}>
              {item.role === "assistant" ? (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </div>
              ) : (
                <p>{item.text}</p>
              )}
              {item.role === "assistant" && item.corrections && item.corrections.length > 0 ? (
                <div className="bubble-meta">
                  <strong>添削</strong>
                  <ul>
                    {item.corrections.map((line, index) => (
                      <li key={`${item.id}-c-${index}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {item.role === "assistant" && item.reviewHints && item.reviewHints.length > 0 ? (
                <div className="bubble-meta">
                  <strong>復習ヒント</strong>
                  <ul>
                    {item.reviewHints.map((line, index) => (
                      <li key={`${item.id}-h-${index}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))
        )}
        {loading ? <article className="bubble assistant">考え中...</article> : null}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <div className="chat-modes">
          {(["ask", "translate", "add_flashcard"] as ChatMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={item === mode ? "chat-mode active" : "chat-mode"}
              onClick={() => setMode(item)}
            >
              {modeLabels[item]}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder={placeholder}
        />
        <button
          type="submit"
          className="chat-send-button"
          disabled={loading || !message.trim()}
          aria-label="送信"
        >
          <SendHorizontal size={18} strokeWidth={2.2} aria-hidden="true" focusable="false" />
          <span className="sr-only">送信</span>
        </button>
      </form>
    </section>
  );
}
