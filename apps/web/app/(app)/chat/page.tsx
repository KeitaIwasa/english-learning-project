"use client";

import { useState } from "react";

type ChatMode = "translate" | "ask" | "add_flashcard";

type ChatResponse = {
  translatedText?: string;
  reply?: string;
  flashcardId?: string;
  en?: string;
  ja?: string;
};

export default function ChatPage() {
  const [mode, setMode] = useState<ChatMode>("ask");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setResult(null);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, message })
    });

    const json = (await res.json()) as ChatResponse;
    setResult(json);
    setLoading(false);
  };

  return (
    <div className="grid">
      <section className="panel">
        <h2>学習チャット</h2>
        <label>
          モード
          <select value={mode} onChange={(e) => setMode(e.target.value as ChatMode)}>
            <option value="translate">翻訳（履歴なし）</option>
            <option value="ask">質問・添削（履歴あり）</option>
            <option value="add_flashcard">フラッシュカード追加</option>
          </select>
        </label>
        <label>
          メッセージ
          <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <button onClick={submit} disabled={loading || !message.trim()}>
          {loading ? "送信中..." : "送信"}
        </button>
      </section>

      <section className="panel">
        <h2>結果</h2>
        {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : <p className="muted">まだ結果がありません。</p>}
      </section>
    </div>
  );
}
