"use client";

import { useState } from "react";

export function ReadingGenerateButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const trigger = async () => {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/reading/generate", { method: "POST" });
    const data = (await res.json()) as { created: boolean; error?: string };
    setMessage(data.error ? `失敗: ${data.error}` : data.created ? "今日の音読文を生成しました。" : "本日はすでに生成済みです。");
    setLoading(false);
  };

  return (
    <div>
      <button onClick={trigger} disabled={loading}>
        {loading ? "生成中..." : "今日の音読文を再生成"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
