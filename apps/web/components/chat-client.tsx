"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatMode = "translate" | "ask" | "add_flashcard";

type ChatResponse = {
  translatedText?: string;
  reply?: string;
  flashcardId?: string;
  en?: string;
  ja?: string;
  corrections?: string[];
  reviewHints?: string[];
  error?: string;
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

export function ChatClient() {
  const [mode, setMode] = useState<ChatMode>("ask");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const placeholder = useMemo(() => {
    if (mode === "translate") {
      return "翻訳したい文を入力";
    }
    if (mode === "add_flashcard") {
      return "英語 || 日本語（日本語は任意）";
    }
    return "英語の質問や添削してほしい文を入力";
  }, [mode]);

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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: currentMode, message: trimmed })
      });
      const json = (await res.json()) as ChatResponse;

      let assistantText = "応答を取得できませんでした。";
      if (currentMode === "translate" && json.translatedText) {
        assistantText = json.translatedText;
      } else if (currentMode === "add_flashcard" && json.flashcardId) {
        assistantText = `フラッシュカードに追加しました。\nEN: ${json.en ?? "-"}\nJA: ${json.ja ?? "-"}`;
      } else if (json.reply) {
        assistantText = json.reply;
      } else if (json.error) {
        assistantText = `エラー: ${json.error}`;
      }

      const assistantMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: assistantText,
        mode: currentMode,
        corrections: json.corrections,
        reviewHints: json.reviewHints
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `通信エラー: ${String(error)}`,
          mode: currentMode
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel chat-shell">
      <header className="chat-header">
        <h2>学習チャット</h2>
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
      </header>

      <div className="chat-timeline">
        {messages.length === 0 ? (
          <p className="muted">質問を送るとここに会話が表示されます。</p>
        ) : (
          messages.map((item) => (
            <article key={item.id} className={item.role === "user" ? "bubble user" : "bubble assistant"}>
              <p>{item.text}</p>
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
        <button type="submit" disabled={loading || !message.trim()}>
          送信
        </button>
      </form>
    </section>
  );
}
