"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

type ReadingLineCardProps = {
  linked: boolean;
  pushEnabled: boolean;
  linkStatus: "unlinked" | "pending" | "linked";
  linkedAt: string | null;
  lastDeliveryAt: string | null;
  activeCode: {
    code: string;
    expiresAt: string;
  } | null;
  latestJob: {
    status: "queued" | "processing" | "completed" | "failed";
    targetDate: string;
    error: string | null;
    completedAt: string | null;
  } | null;
};

type LineJobStatus = "queued" | "processing" | "completed" | "failed";

export function ReadingLineCard(props: ReadingLineCardProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<"code" | "toggle" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [activeCode, setActiveCode] = useState(props.activeCode);

  const createCode = async () => {
    setLoadingAction("code");
    setMessage("");
    try {
      const response = await fetch("/api/line/link-code", { method: "POST" });
      const json = (await response.json()) as { code?: string; expiresAt?: string; error?: string; reused?: boolean };
      if (!response.ok || !json.code || !json.expiresAt) {
        setMessage(json.error ?? "連携コードの発行に失敗しました。");
        return;
      }
      setActiveCode({
        code: json.code,
        expiresAt: json.expiresAt
      });
      setMessage(json.reused ? "有効な連携コードを表示しました。" : "連携コードを発行しました。");
      router.refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  const toggleEnabled = async () => {
    setLoadingAction("toggle");
    setMessage("");
    try {
      const response = await fetch("/api/line/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !props.pushEnabled })
      });
      const json = (await response.json()) as { enabled?: boolean; error?: string };
      if (!response.ok) {
        setMessage(json.error ?? "設定の更新に失敗しました。");
        return;
      }
      setMessage(json.enabled ? "LINE自動送信をONにしました。" : "LINE自動送信をOFFにしました。");
      router.refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  const sendTest = async () => {
    setLoadingAction("test");
    setMessage("");
    try {
      const response = await fetch("/api/line/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const json = (await response.json()) as { error?: string; targetDate?: string };
      if (!response.ok) {
        setMessage(json.error ?? "テスト送信の開始に失敗しました。");
        return;
      }
      setMessage(`LINEテスト送信を開始しました。対象日: ${json.targetDate ?? "最新"}`);
      router.refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <section className="panel">
      <h3>LINE 自動送信</h3>
      {!props.linked ? (
        <>
          <p className="muted">
            LINE公式アカウントを友だち追加したあと、アプリで発行したコードを <code>link ABCD1234</code> の形式で送ると連携できます。
          </p>
          <button type="button" onClick={createCode} disabled={loadingAction !== null}>
            {loadingAction === "code" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <LoaderCircle size={16} className="spin" />
                <span>発行中</span>
              </span>
            ) : activeCode ? (
              "連携コードを再表示"
            ) : (
              "連携コードを発行"
            )}
          </button>
          {activeCode ? (
            <>
              <p>
                連携コード: <code>{activeCode.code}</code>
              </p>
              <p className="muted">有効期限: {formatDate(activeCode.expiresAt)}</p>
            </>
          ) : null}
        </>
      ) : (
        <>
          <p className="muted">
            連携済みです。{props.pushEnabled ? "毎朝06:00に自動送信します。" : "現在は自動送信OFFです。"}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={toggleEnabled} disabled={loadingAction !== null}>
              {loadingAction === "toggle" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <LoaderCircle size={16} className="spin" />
                  <span>更新中</span>
                </span>
              ) : props.pushEnabled ? (
                "自動送信をOFF"
              ) : (
                "自動送信をON"
              )}
            </button>
            <button type="button" className="secondary" onClick={sendTest} disabled={loadingAction !== null}>
              {loadingAction === "test" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <LoaderCircle size={16} className="spin" />
                  <span>送信開始中</span>
                </span>
              ) : (
                "テスト送信"
              )}
            </button>
          </div>
          {props.linkedAt ? <p className="muted">連携日時: {formatDate(props.linkedAt)}</p> : null}
          {props.lastDeliveryAt ? <p className="muted">最終送信: {formatDate(props.lastDeliveryAt)}</p> : null}
        </>
      )}

      {props.latestJob ? (
        <p className="muted">
          最新ジョブ: {statusLabel(props.latestJob.status)} / 対象日 {props.latestJob.targetDate}
          {props.latestJob.completedAt ? ` / 完了 ${formatDate(props.latestJob.completedAt)}` : ""}
          {props.latestJob.error ? ` / ${props.latestJob.error}` : ""}
        </p>
      ) : null}
      {props.linkStatus === "pending" && !props.linked ? (
        <p className="muted">コード送信後、LINE側で連携が完了するとこの画面に反映されます。</p>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function statusLabel(status: LineJobStatus) {
  if (status === "queued") {
    return "queued";
  }
  if (status === "processing") {
    return "processing";
  }
  if (status === "completed") {
    return "completed";
  }
  return "failed";
}
