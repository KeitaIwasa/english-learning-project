"use client";

type ReadingAudioButtonProps = {
  passageId: string;
  audioMimeType: string | null;
  audioVoice: string | null;
};

export function ReadingAudioButton({ passageId, audioMimeType }: ReadingAudioButtonProps) {
  const canPlay = Boolean(audioMimeType);
  const src = `/api/reading/audio/${passageId}?v=2`;
  const sourceType = resolvePlayableMimeType(audioMimeType);

  return (
    <div className="reading-audio-wrap">
      {canPlay ? (
        <audio className="reading-audio-player" controls preload="none">
          <source src={src} type={sourceType} />
          お使いのブラウザは音声再生に対応していません。
        </audio>
      ) : null}
      {!canPlay ? <p className="muted">音声は未生成です。</p> : null}
    </div>
  );
}

function resolvePlayableMimeType(value: string | null): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "audio/wav";
  }
  if (normalized.startsWith("audio/l16") || normalized.includes("codec=pcm") || normalized.includes("audio/pcm")) {
    return "audio/wav";
  }
  return normalized;
}
