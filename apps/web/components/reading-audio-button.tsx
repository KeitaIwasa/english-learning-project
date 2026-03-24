"use client";

type ReadingAudioButtonProps = {
  passageId: string;
  audioMimeType: string | null;
  audioVoice: string | null;
};

export function ReadingAudioButton({ passageId, audioMimeType, audioVoice }: ReadingAudioButtonProps) {
  const canPlay = Boolean(audioMimeType);

  return (
    <div className="reading-audio-wrap">
      {canPlay ? (
        <audio className="reading-audio-player" controls preload="none">
          <source src={`/api/reading/audio/${passageId}`} type={audioMimeType ?? "audio/wav"} />
          お使いのブラウザは音声再生に対応していません。
        </audio>
      ) : null}
      {!canPlay ? <p className="muted">音声は未生成です。</p> : null}
    </div>
  );
}
