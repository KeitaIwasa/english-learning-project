"use client";

import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";

type ReadingAudioButtonProps = {
  audioBase64: string | null;
  audioMimeType: string | null;
  audioVoice: string | null;
};

export function ReadingAudioButton({ audioBase64, audioMimeType, audioVoice }: ReadingAudioButtonProps) {
  const [error, setError] = useState("");
  const canPlay = Boolean(audioBase64 && audioMimeType);

  const dataUrl = useMemo(() => {
    if (!audioBase64 || !audioMimeType) {
      return "";
    }
    return `data:${audioMimeType};base64,${audioBase64}`;
  }, [audioBase64, audioMimeType]);

  const play = async () => {
    if (!dataUrl) {
      return;
    }

    try {
      setError("");
      const audio = new Audio(dataUrl);
      await audio.play();
    } catch {
      setError("音声を再生できませんでした。");
    }
  };

  return (
    <div className="reading-audio-wrap">
      <button
        type="button"
        className="secondary reading-audio-button"
        onClick={play}
        disabled={!canPlay}
        aria-label="音声を再生"
        title={canPlay ? `音声を再生 (${audioVoice ?? "default"})` : "音声は未生成です"}
      >
        <Volume2 size={18} />
      </button>
      {!canPlay ? <p className="muted">音声は未生成です。</p> : null}
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
