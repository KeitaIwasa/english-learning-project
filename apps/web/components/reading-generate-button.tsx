"use client";

import { useState } from "react";

export function ReadingGenerateButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const trigger = async () => {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/reading/generate", { method: "POST" });
    const data = (await res.json()) as { created: boolean; hasAudio?: boolean; error?: string };
    if (data.error) {
      setMessage(`失敗: ${data.error}`);
    } else if (!data.created) {
      setMessage(data.hasAudio ? "本日はすでに生成済みです（音声あり）。" : "本日はすでに生成済みです（音声なし）。");
    } else if (data.hasAudio) {
      setMessage("今日の音読文と音声を生成しました。");
    } else {
      setMessage("本文を生成しました（音声生成は失敗）。");
    }
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
