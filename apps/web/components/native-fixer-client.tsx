"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, CheckCircle2, CircleAlert, CloudUpload, LoaderCircle, Plus } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type JobStatus = "uploaded" | "queued" | "processing" | "completed" | "failed";

type HistoryItem = {
  id: string;
  fileName: string;
  customTitle: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type Correction = {
  index: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
  addedFlashcardId: string | null;
};

type JobDetail = {
  id: string;
  fileName: string;
  customTitle: string | null;
  fileSize: number;
  mimeType: string;
  status: JobStatus;
  transcriptFull: string | null;
  corrections: Correction[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ModalState = {
  correctionIndex: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
};

const ACCEPTED_AUDIO = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/mp4,audio/m4a";
const MAX_FILE_SIZE_BYTES = 262_144_000;

export function NativeFixerClient() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [titleEditingId, setTitleEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  const selectedHistory = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    void loadHistory(true);
    const timer = setInterval(() => {
      void loadHistory(false);
    }, 8_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    void loadDetail(selectedId, true);
  }, [selectedId]);

  useEffect(() => {
    if (!detail || !["uploaded", "queued", "processing"].includes(detail.status)) {
      return;
    }
    const timer = setInterval(() => {
      void loadDetail(detail.id, false);
      void loadHistory(false);
    }, 5_000);
    return () => clearInterval(timer);
  }, [detail]);

  useEffect(() => {
    const hasFilePayload = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      return types.includes("Files");
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      setDraggingFile(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setDraggingFile(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDraggingFile(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = 0;
      setDraggingFile(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        void uploadAudioFile(file);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const uploadAudioFile = async (file: File) => {
    if (uploading) {
      return;
    }
    setErrorMessage("");

    if (!isSupportedAudioFile(file)) {
      setErrorMessage("対応していない音声形式です（MP3 / WAV / AAC / M4A）。");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage("ファイルサイズは250MB以下にしてください。");
      return;
    }

    setUploading(true);
    setBusyMessage("アップロード中...");

    try {
      const createRes = await fetch("/api/native-fixer/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "audio/mpeg"
        })
      });
      const createJson = (await createRes.json()) as {
        jobId?: string;
        uploadPath?: string;
        token?: string;
        signedUploadUrl?: string;
        error?: string;
      };

      if (!createRes.ok || !createJson.jobId || !createJson.uploadPath || !createJson.token) {
        throw new Error(createJson.error ?? "ジョブ作成に失敗しました。");
      }

      const browserClient = createSupabaseBrowserClient();
      const uploadResult = await browserClient.storage
        .from("speech-fixer-temp")
        .uploadToSignedUrl(createJson.uploadPath, createJson.token, file, {
          upsert: false
        });

      if (uploadResult.error) {
        throw new Error(`音声アップロードに失敗しました: ${uploadResult.error.message}`);
      }

      const queueRes = await fetch(`/api/native-fixer/jobs/${createJson.jobId}/upload-complete`, {
        method: "POST"
      });
      if (!queueRes.ok) {
        const text = await queueRes.text();
        throw new Error(`キュー投入に失敗しました: ${text}`);
      }

      await loadHistory(false);
      setSelectedId(createJson.jobId);
      setBusyMessage("解析キューに追加しました。通常1-2分で完了します。");
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setUploading(false);
      setTimeout(() => setBusyMessage(""), 2500);
    }
  };

  const onUploadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void uploadAudioFile(file);
  };

  const openEditTitle = (item: HistoryItem) => {
    setTitleEditingId(item.id);
    setTitleDraft(item.customTitle ?? item.fileName);
  };

  const submitTitle = async (itemId: string) => {
    const value = titleDraft.trim();
    setTitleEditingId(null);
    setErrorMessage("");
    const response = await fetch(`/api/native-fixer/jobs/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customTitle: value })
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      setErrorMessage(json.error ?? "タイトルの保存に失敗しました。");
      return;
    }
    await loadHistory(false);
    if (selectedId === itemId) {
      await loadDetail(itemId, false);
    }
  };

  const openAddCardModal = (correctionIndex: number) => {
    const target = detail?.corrections[correctionIndex];
    if (!target || target.addedFlashcardId) {
      return;
    }
    setModal({
      correctionIndex,
      original: target.original,
      corrected: target.corrected,
      ja: target.ja,
      reasonJa: target.reasonJa
    });
  };

  const submitAddCard = async () => {
    if (!modal || !detail || addingCard) {
      return;
    }
    const en = modal.corrected.trim();
    if (!en) {
      setErrorMessage("修正後英文は必須です。");
      return;
    }

    setAddingCard(true);
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/native-fixer/jobs/${detail.id}/corrections/${modal.correctionIndex}/add-flashcard`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            en,
            ja: modal.ja.trim() || undefined
          })
        }
      );
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "フラッシュカード追加に失敗しました。");
      }

      await loadDetail(detail.id, false);
      setModal(null);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setAddingCard(false);
    }
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>, itemId: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitTitle(itemId);
    } else if (event.key === "Escape") {
      setTitleEditingId(null);
    }
  };

  async function loadHistory(withLoading: boolean) {
    if (withLoading) {
      setLoadingList(true);
    }
    try {
      const response = await fetch("/api/native-fixer/jobs", { method: "GET" });
      const json = (await response.json()) as { items?: HistoryItem[]; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "履歴の取得に失敗しました。");
      }
      const nextItems = Array.isArray(json.items) ? json.items : [];
      setItems(nextItems);
      setSelectedId((prev) => prev ?? nextItems[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      if (withLoading) {
        setLoadingList(false);
      }
    }
  }

  async function loadDetail(jobId: string, withLoading: boolean) {
    if (withLoading) {
      setLoadingDetail(true);
    }
    try {
      const response = await fetch(`/api/native-fixer/jobs/${jobId}`, { method: "GET" });
      const json = (await response.json()) as { item?: JobDetail; error?: string };
      if (!response.ok || !json.item) {
        throw new Error(json.error ?? "解析詳細の取得に失敗しました。");
      }
      setDetail(json.item);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      if (withLoading) {
        setLoadingDetail(false);
      }
    }
  }

  return (
    <div className="nfx-page">
      <aside className="panel nfx-sidebar">
        <h2 className="nfx-sidebar-title">解析履歴</h2>
        {loadingList ? <p className="muted">読み込み中...</p> : null}
        {!loadingList && items.length === 0 ? <p className="muted">まだ履歴がありません。</p> : null}

        <div className="nfx-history-list">
          {items.map((item) => {
            const active = item.id === selectedId;
            const title = item.customTitle || item.fileName;
            return (
              <button
                type="button"
                key={item.id}
                className={`nfx-history-item${active ? " active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="nfx-history-item-top">
                  {titleEditingId === item.id ? (
                    <input
                      value={titleDraft}
                      autoFocus
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => void submitTitle(item.id)}
                      onKeyDown={(event) => onTitleKeyDown(event, item.id)}
                    />
                  ) : (
                    <strong
                      className="nfx-history-title"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openEditTitle(item);
                      }}
                    >
                      {title}
                    </strong>
                  )}
                  <StatusBadge status={item.status} />
                </div>
                <span className="nfx-history-date">{formatDateTime(item.completedAt || item.createdAt)}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="nfx-main">
        <section className="panel nfx-hero">
          <div className="nfx-hero-icon">
            <AudioLines size={24} />
          </div>
          <div>
            <h1>Native English Fixer</h1>
            <p>音声をアップロードして、文字起こしと自然な英語への添削をまとめて行います。</p>
          </div>
        </section>

        <section className="panel nfx-upload">
          <CloudUpload size={36} />
          <h3>音声ファイルをアップロード</h3>
          <p className="muted">MP3 / WAV / AAC / M4A（最大250MB）</p>
          <label className="nfx-upload-button">
            {uploading ? "アップロード中..." : "ファイルを選択"}
            <input type="file" accept={ACCEPTED_AUDIO} onChange={onUploadFile} disabled={uploading} />
          </label>
          {busyMessage ? <p className="nfx-info">{busyMessage}</p> : null}
          {errorMessage ? <p className="nfx-error">{errorMessage}</p> : null}
        </section>

        <section className="panel nfx-result">
          {!selectedHistory ? <p className="muted">左の履歴から解析結果を選択してください。</p> : null}

          {selectedHistory && loadingDetail ? (
            <p className="muted">解析詳細を読み込み中...</p>
          ) : null}

          {selectedHistory && detail ? (
            <>
              <div className="nfx-result-head">
                <h3>{detail.customTitle || detail.fileName}</h3>
                <StatusBadge status={detail.status} />
              </div>

              {detail.status === "failed" ? (
                <div className="nfx-status-card error">
                  <CircleAlert size={17} />
                  <span>{detail.errorMessage || "解析に失敗しました。"}</span>
                </div>
              ) : null}

              {["uploaded", "queued", "processing"].includes(detail.status) ? (
                <div className="nfx-status-card">
                  <LoaderCircle size={17} className="spin" />
                  <span>解析中です。通常1-2分で完了します。</span>
                </div>
              ) : null}

              {detail.status === "completed" ? (
                <div className="nfx-completed">
                  <div className="nfx-transcript">
                    <h4>文字起こし全文</h4>
                    <div className="nfx-transcript-body">{detail.transcriptFull || "(文字起こし結果なし)"}</div>
                  </div>

                  <div className="nfx-corrections">
                    <h4>修正リスト</h4>
                    {detail.corrections.length === 0 ? <p className="muted">修正が必要な文は見つかりませんでした。</p> : null}
                    {detail.corrections.map((correction, idx) => (
                      <article key={`${correction.index}-${idx}`} className="nfx-correction-card">
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
                          <button type="button" className="nfx-add-btn" onClick={() => openAddCardModal(idx)}>
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
      </section>

      {modal ? (
        <div className="nfx-modal-backdrop" role="dialog" aria-modal="true" aria-label="フラッシュカード追加確認">
          <div className="nfx-modal panel">
            <h3>フラッシュカードに追加</h3>
            <label>
              元の英文
              <textarea value={modal.original} readOnly rows={2} />
            </label>
            <label>
              修正後の英文
              <textarea
                value={modal.corrected}
                rows={3}
                onChange={(event) =>
                  setModal((prev) =>
                    prev
                      ? {
                        ...prev,
                        corrected: event.target.value
                      }
                      : prev
                  )
                }
              />
            </label>
            <label>
              日本語訳
              <textarea
                value={modal.ja}
                rows={3}
                onChange={(event) =>
                  setModal((prev) =>
                    prev
                      ? {
                        ...prev,
                        ja: event.target.value
                      }
                      : prev
                  )
                }
              />
            </label>
            <label>
              理由
              <textarea value={modal.reasonJa} readOnly rows={2} />
            </label>
            <div className="nfx-modal-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)} disabled={addingCard}>
                キャンセル
              </button>
              <button type="button" onClick={() => void submitAddCard()} disabled={addingCard}>
                {addingCard ? "追加中..." : "この内容で追加"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draggingFile ? (
        <div className="nfx-drop-overlay" aria-hidden="true">
          <div className="nfx-drop-overlay-card">
            <CloudUpload size={34} />
            <p>ファイルをドロップしてアップロード</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isSupportedAudioFile(file: File) {
  const mime = (file.type || "").toLowerCase();
  if (mime && ACCEPTED_AUDIO.split(",").includes(mime)) {
    return true;
  }
  const name = file.name.toLowerCase();
  return [".mp3", ".wav", ".aac", ".m4a"].some((ext) => name.endsWith(ext));
}

function StatusBadge({ status }: { status: JobStatus }) {
  const label = status === "completed" ? "完了" : status === "failed" ? "失敗" : "解析中";
  return <span className={`nfx-status ${status}`}>{label}</span>;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
