"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { AudioLines, Check, CheckCircle2, CircleAlert, CloudUpload, Copy, LoaderCircle, Plus } from "lucide-react";
import {
  buildTranscriptCopyText,
  formatTranscriptForDisplay,
  getTranscriptSpeakerLabel
} from "@/lib/native-fixer-transcript";
import type { CorrectionSpeakerFilter, HistoryItem, JobDetail, ViewMode } from "./shared";
import { NativeFixerStatusBadge } from "./history-sidebar";

type NativeFixerResultPanelProps = {
  viewMode: ViewMode;
  uploading: boolean;
  busyMessage: string;
  errorMessage: string;
  selectedHistory: HistoryItem | null;
  detail: JobDetail | null;
  loadingDetail: boolean;
  visibleCorrections: Array<{ correction: JobDetail["corrections"][number]; originalIndex: number }>;
  speakerFilter: CorrectionSpeakerFilter;
  onUploadFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onSpeakerFilterChange: (value: CorrectionSpeakerFilter) => void;
  onOpenAddCardModal: (correctionIndex: number) => void;
};

const ACCEPTED_AUDIO = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/mp4,audio/m4a";

export function NativeFixerResultPanel(props: NativeFixerResultPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const transcriptCopyText = useMemo(
    () =>
      props.detail
        ? buildTranscriptCopyText({
            transcriptFull: props.detail.transcriptFull,
            transcriptTurns: props.detail.transcriptTurns
          })
        : "",
    [props.detail]
  );

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopyTranscript = async () => {
    if (!transcriptCopyText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcriptCopyText);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section className="nfx-main">
      {props.viewMode === "create" ? (
        <section className="panel nfx-hero">
          <div className="nfx-hero-icon">
            <AudioLines size={24} />
          </div>
          <div>
            <h1>Native English Fixer</h1>
            <p>音声をアップロードして、文字起こしと自然な英語への添削をまとめて行います。</p>
          </div>
        </section>
      ) : null}

      {props.viewMode === "create" ? (
        <section className="panel nfx-upload">
          <CloudUpload size={36} />
          <h3>音声ファイルをアップロード</h3>
          <p className="muted">MP3 / WAV / AAC / M4A（最大250MB）</p>
          <label className="nfx-upload-button">
            {props.uploading ? "アップロード中..." : "ファイルを選択"}
            <input type="file" accept={ACCEPTED_AUDIO} onChange={props.onUploadFile} disabled={props.uploading} />
          </label>
          {props.busyMessage ? <p className="nfx-info">{props.busyMessage}</p> : null}
          {props.errorMessage ? <p className="nfx-error">{props.errorMessage}</p> : null}
        </section>
      ) : null}

      {props.viewMode === "history" ? (
        <section className="panel nfx-result">
          {!props.selectedHistory ? <p className="muted">左の履歴から解析結果を選択してください。</p> : null}

          {props.selectedHistory && props.loadingDetail ? <p className="muted">解析詳細を読み込み中...</p> : null}

          {props.selectedHistory && props.detail ? (
            <>
              <div className="nfx-result-head">
                <h3>{props.detail.customTitle || props.detail.fileName}</h3>
                <NativeFixerStatusBadge status={props.detail.status} />
              </div>

              {props.detail.status === "failed" ? (
                <div className="nfx-status-card error">
                  <CircleAlert size={17} />
                  <span>{props.detail.errorMessage || "解析に失敗しました。"}</span>
                </div>
              ) : null}

              {["uploaded", "queued", "processing"].includes(props.detail.status) ? (
                <div className="nfx-status-card">
                  <LoaderCircle size={17} className="spin" />
                  <span>解析中です。通常1-2分で完了します。</span>
                </div>
              ) : null}

              {props.detail.status === "completed" ? (
                <div className="nfx-completed">
                  <div className="nfx-transcript">
                    <div className="nfx-section-head">
                      <h4>文字起こし全文</h4>
                      <button
                        type="button"
                        className="secondary nfx-copy-btn"
                        onClick={() => void handleCopyTranscript()}
                        disabled={!transcriptCopyText}
                        aria-label="文字起こし全文をコピー"
                      >
                        {copyState === "success" ? <Check size={15} /> : <Copy size={15} />}
                        {copyState === "success" ? "コピー済み" : copyState === "error" ? "再試行" : "コピー"}
                      </button>
                    </div>
                    <div className="nfx-transcript-body">
                      {props.detail.transcriptTurns.length > 0 ? (
                        <div className="nfx-transcript-turns">
                          {props.detail.transcriptTurns.map((turn, idx) => (
                            <article key={`${props.detail?.id}-turn-${idx}`} className={`nfx-turn-card speaker-${turn.speaker}`}>
                              <p className="nfx-turn-speaker">{getTranscriptSpeakerLabel(turn.speaker)}</p>
                              <p className="nfx-turn-text">{turn.text}</p>
                            </article>
                          ))}
                        </div>
                      ) : props.detail.transcriptFull ? (
                        formatTranscriptForDisplay(props.detail.transcriptFull)
                      ) : (
                        "(文字起こし結果なし)"
                      )}
                    </div>
                    {copyState === "error" ? <p className="nfx-copy-error">コピーに失敗しました。もう一度試してください。</p> : null}
                  </div>

                  <div className="nfx-corrections">
                    <h4>修正リスト</h4>
                    {props.detail.corrections.length > 0 ? (
                      <div className="nfx-filter-row" role="group" aria-label="話者フィルタ">
                        <button
                          type="button"
                          className={`secondary nfx-filter-btn${props.speakerFilter === "all" ? " active" : ""}`}
                          onClick={() => props.onSpeakerFilterChange("all")}
                        >
                          全員
                        </button>
                        <button
                          type="button"
                          className={`secondary nfx-filter-btn${props.speakerFilter === "speaker1" ? " active" : ""}`}
                          onClick={() => props.onSpeakerFilterChange("speaker1")}
                        >
                          Speaker 1
                        </button>
                        <button
                          type="button"
                          className={`secondary nfx-filter-btn${props.speakerFilter === "speaker2" ? " active" : ""}`}
                          onClick={() => props.onSpeakerFilterChange("speaker2")}
                        >
                          Speaker 2
                        </button>
                      </div>
                    ) : null}
                    {props.detail.corrections.length === 0 ? <p className="muted">修正が必要な文は見つかりませんでした。</p> : null}
                    {props.detail.corrections.length > 0 && props.visibleCorrections.length === 0 ? (
                      <p className="muted">この条件に一致する修正はありません。</p>
                    ) : null}
                    {props.visibleCorrections.map(({ correction, originalIndex }) => (
                      <article key={`${correction.index}-${originalIndex}`} className="nfx-correction-card">
                        <div className="nfx-correction-head">
                          <span className={`nfx-speaker-chip speaker-${correction.speaker}`}>
                            {getTranscriptSpeakerLabel(correction.speaker)}
                          </span>
                        </div>
                        <div className="nfx-correction-grid">
                          <div>
                            <p className="nfx-label">元の英文</p>
                            <p className="nfx-original">{correction.original}</p>
                          </div>
                          <div>
                            <p className="nfx-label">日本語訳</p>
                            <p className="nfx-ja">{correction.ja}</p>
                          </div>
                        </div>
                        <div>
                          <p className="nfx-label">修正後の英文</p>
                          <p className="nfx-corrected">{correction.corrected}</p>
                        </div>
                        <div>
                          <p className="nfx-label">理由</p>
                          <p className="nfx-reason">{correction.reasonJa}</p>
                        </div>
                        {correction.addedFlashcardId ? (
                          <span className="nfx-added-chip">
                            <CheckCircle2 size={16} />
                            追加済み
                          </span>
                        ) : (
                          <button type="button" className="nfx-add-btn" onClick={() => props.onOpenAddCardModal(originalIndex)}>
                            <Plus size={16} />
                            フラッシュカード追加
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
