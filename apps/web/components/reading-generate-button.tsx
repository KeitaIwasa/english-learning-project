"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

type ReadingJobStatus = "queued" | "processing" | "completed" | "failed";

type ReadingGenerateApiResponse = {
  queued?: boolean;
  created?: boolean;
  hasAudio?: boolean;
  error?: string;
  status?: ReadingJobStatus | null;
};

const POLLING_MS = 4000;

export function ReadingGenerateButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [jobStatus, setJobStatus] = useState<ReadingJobStatus | null>(null);
  const [message, setMessage] = useState("");
  const previousStatusRef = useRef<ReadingJobStatus | null>(null);

  const isGenerating = jobStatus === "queued" || jobStatus === "processing" || submitting;

  useEffect(() => {
    void fetchStatus({ showErrorMessage: false, forceRefresh: false });
  }, []);

  useEffect(() => {
    if (jobStatus !== "queued" && jobStatus !== "processing") {
      previousStatusRef.current = jobStatus;
      return;
    }

    const timer = setInterval(() => {
      void fetchStatus({ showErrorMessage: true, forceRefresh: true });
    }, POLLING_MS);

    previousStatusRef.current = jobStatus;
    return () => clearInterval(timer);
  }, [jobStatus]);

  const fetchStatus = async (params: { showErrorMessage: boolean; forceRefresh: boolean }) => {
    try {
      const response = await fetch("/api/reading/generate", { method: "GET", cache: "no-store" });
      if (!response.ok) {
        if (params.showErrorMessage) {
          setMessage("生成状態の取得に失敗しました。");
        }
        return;
      }

      const data = (await response.json()) as {
        status: ReadingJobStatus | null;
        error?: string | null;
      };
      const nextStatus = data.status ?? null;
      const prevStatus = previousStatusRef.current;

      setJobStatus(nextStatus);

      if (nextStatus === "failed") {
        setMessage(data.error ? `失敗: ${data.error}` : "失敗: 生成処理でエラーが発生しました。");
        previousStatusRef.current = nextStatus;
        return;
      }

      if ((prevStatus === "queued" || prevStatus === "processing") && nextStatus === "completed") {
        setMessage("今日の音読文の生成が完了しました。");
        if (params.forceRefresh) {
          router.refresh();
        }
      }

      previousStatusRef.current = nextStatus;
    } catch {
      if (params.showErrorMessage) {
        setMessage("生成状態の取得に失敗しました。");
      }
    }
  };

  const trigger = async () => {
    if (isGenerating) {
      return;
    }

    setSubmitting(true);
    setMessage("");
    setJobStatus("queued");
    previousStatusRef.current = "queued";

    try {
      const res = await fetch("/api/reading/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true })
      });
      const data = (await res.json()) as ReadingGenerateApiResponse;

      if (res.status === 409) {
        setJobStatus((data.status as ReadingJobStatus | null) ?? "processing");
        setMessage("すでに生成中です。");
        return;
      }

      if (!res.ok || data.error) {
        setJobStatus((data.status as ReadingJobStatus | null) ?? "failed");
        setMessage(`失敗: ${data.error ?? "生成に失敗しました。"}`);
        return;
      }

      if (data.queued || data.status === "queued" || data.status === "processing") {
        setJobStatus((data.status as ReadingJobStatus | null) ?? "queued");
        setMessage("生成を開始しました。完了までしばらくお待ちください。");
        return;
      }

      setJobStatus((data.status as ReadingJobStatus | null) ?? "completed");
      if (!data.created) {
        setMessage(data.hasAudio ? "本日はすでに生成済みです（音声あり）。" : "本日はすでに生成済みです（音声なし）。");
      } else if (data.hasAudio) {
        setMessage("今日の音読文と音声を生成しました。");
      } else {
        setMessage("本文を生成しました（音声生成は失敗）。");
      }
      router.refresh();
    } catch (error) {
      setJobStatus("failed");
      setMessage(`失敗: ${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button onClick={trigger} disabled={isGenerating}>
        {isGenerating ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <LoaderCircle size={16} className="spin" />
            <span>生成中</span>
          </span>
        ) : (
          "今日の音読文を再生成"
        )}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
