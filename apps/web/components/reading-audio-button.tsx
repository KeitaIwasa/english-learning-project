"use client";

import { useMemo } from "react";

type ReadingAudioButtonProps = {
  audioBase64: string | null;
  audioMimeType: string | null;
  audioVoice: string | null;
};

export function ReadingAudioButton({ audioBase64, audioMimeType, audioVoice }: ReadingAudioButtonProps) {
  const canPlay = Boolean(audioBase64 && audioMimeType);

  const dataUrl = useMemo(() => {
    if (!audioBase64 || !audioMimeType) {
      return "";
    }
    return `data:${audioMimeType};base64,${audioBase64}`;
  }, [audioBase64, audioMimeType]);

  return (
    <div className="reading-audio-wrap">
      {canPlay ? (
        <audio className="reading-audio-player" controls preload="none">
          <source src={dataUrl} type={audioMimeType ?? "audio/wav"} />
          お使いのブラウザは音声再生に対応していません。
        </audio>
      ) : null}
      {!canPlay ? <p className="muted">音声は未生成です。</p> : null}
    </div>
  );
}
