"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import {
  addNativeFixerFlashcard,
  createNativeFixerJob,
  fetchNativeFixerDetail,
  fetchNativeFixerHistory,
  queueNativeFixerJob,
  updateNativeFixerTitle,
  uploadNativeFixerFile
} from "@/components/native-fixer/api";
import { NativeFixerAddCardModal } from "@/components/native-fixer/add-card-modal";
import { NativeFixerHistorySidebar } from "@/components/native-fixer/history-sidebar";
import { NativeFixerResultPanel } from "@/components/native-fixer/result-panel";
import type { CorrectionSpeakerFilter, HistoryItem, JobDetail, ModalState, ViewMode } from "@/components/native-fixer/shared";

const ACCEPTED_AUDIO = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/mp4,audio/m4a";
const MAX_FILE_SIZE_BYTES = 262_144_000;

export function NativeFixerClient() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("create");
  const [isHistoryOpenOnMobile, setIsHistoryOpenOnMobile] = useState(false);
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
  const [speakerFilter, setSpeakerFilter] = useState<CorrectionSpeakerFilter>("all");
  const dragDepthRef = useRef(0);

  const selectedHistory = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const visibleCorrections = useMemo(() => {
    const corrections = detail?.corrections ?? [];
    return corrections
      .map((correction, originalIndex) => ({ correction, originalIndex }))
      .filter(({ correction }) => {
        if (speakerFilter === "all") {
          return true;
        }
        if (correction.speaker === "unknown") {
          return true;
        }
        if (speakerFilter === "speaker1") {
          return correction.speaker === 1;
        }
        return correction.speaker === 2;
      });
  }, [detail?.corrections, speakerFilter]);

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
    setSpeakerFilter("all");
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
      const { response: createRes, json: createJson } = await createNativeFixerJob(file);

      if (!createRes.ok || !createJson.jobId || !createJson.gcsObjectName || !createJson.gcsSignedUploadUrl) {
        throw new Error(createJson.error ?? "ジョブ作成に失敗しました。");
      }

      const uploadRes = await uploadNativeFixerFile({
        file,
        gcsSignedUploadUrl: createJson.gcsSignedUploadUrl,
        requiredHeaders: createJson.requiredHeaders
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        throw new Error(`音声アップロードに失敗しました: ${uploadRes.status} ${body}`);
      }

      const queueRes = await queueNativeFixerJob(createJson.jobId);
      if (!queueRes.ok) {
        const text = await queueRes.text();
        throw new Error(`キュー投入に失敗しました: ${text}`);
      }

      await loadHistory(false);
      setSelectedId(createJson.jobId);
      setViewMode("history");
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
    const { response, json } = await updateNativeFixerTitle(itemId, value);
    if (!response.ok) {
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
    setErrorMessage("");
    setModal({
      correctionIndex,
      corrected: target.corrected,
      ja: target.ja
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
      const { response, json } = await addNativeFixerFlashcard({
        jobId: detail.id,
        correctionIndex: modal.correctionIndex,
        en,
        ja: modal.ja.trim() || undefined
      });
      if (!response.ok) {
        if (response.status === 409 && typeof json.flashcardId === "string" && json.flashcardId) {
          await loadDetail(detail.id, false);
          setModal(null);
          return;
        }
        const errorText =
          typeof json.error === "string"
            ? json.error
            : json.error
              ? JSON.stringify(json.error)
              : "フラッシュカード追加に失敗しました。";
        throw new Error(errorText);
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

  const isMobileViewport = () => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 960px)").matches;
  };

  async function loadHistory(withLoading: boolean) {
    if (withLoading) {
      setLoadingList(true);
    }
    try {
      const { response, json } = await fetchNativeFixerHistory();
      if (!response.ok) {
        throw new Error(json.error ?? "履歴の取得に失敗しました。");
      }
      const nextItems = Array.isArray(json.items) ? json.items : [];
      setItems(nextItems);
      setSelectedId((prev) => (prev && nextItems.some((item) => item.id === prev) ? prev : null));
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
      const { response, json } = await fetchNativeFixerDetail(jobId);
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
      <NativeFixerHistorySidebar
        loadingList={loadingList}
        items={items}
        selectedId={selectedId}
        viewMode={viewMode}
        isHistoryOpenOnMobile={isHistoryOpenOnMobile}
        titleEditingId={titleEditingId}
        titleDraft={titleDraft}
        onToggleMobile={() => setIsHistoryOpenOnMobile((prev) => !prev)}
        onCreateNew={() => setViewMode("create")}
        onSelectHistory={(itemId) => {
          setSelectedId(itemId);
          setViewMode("history");
          if (isMobileViewport()) {
            setIsHistoryOpenOnMobile(false);
          }
        }}
        onOpenEditTitle={openEditTitle}
        onTitleDraftChange={setTitleDraft}
        onSubmitTitle={(itemId) => {
          void submitTitle(itemId);
        }}
        onTitleKeyDown={onTitleKeyDown}
      />

      <NativeFixerResultPanel
        viewMode={viewMode}
        uploading={uploading}
        busyMessage={busyMessage}
        errorMessage={errorMessage}
        selectedHistory={selectedHistory}
        detail={detail}
        loadingDetail={loadingDetail}
        visibleCorrections={visibleCorrections}
        speakerFilter={speakerFilter}
        onUploadFile={onUploadFile}
        onSpeakerFilterChange={setSpeakerFilter}
        onOpenAddCardModal={openAddCardModal}
      />

      <NativeFixerAddCardModal
        modal={modal}
        addingCard={addingCard}
        errorMessage={errorMessage}
        onClose={() => setModal(null)}
        onChange={setModal}
        onSubmit={() => {
          void submitAddCard();
        }}
      />

      {draggingFile && viewMode === "create" ? (
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
