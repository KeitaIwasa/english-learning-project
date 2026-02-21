"use client";

import { useEffect, useMemo, useState } from "react";

type RecentCard = {
  id: string;
  en: string;
  ja: string;
  created_at: string;
};

type QueueItem = {
  id: string;
  en: string;
  ja: string;
  nextReviewAt: string | null;
  isDue: boolean;
};

type QueueResponse = {
  queue?: QueueItem[];
  total?: number;
  nextDueAt?: string | null;
  error?: string;
};

type ReviewResponse = {
  ok?: boolean;
  nextReviewAt?: string;
  remaining?: number;
  nextDueAt?: string | null;
  error?: string;
};

export function FlashcardsReviewClient({ initialCards }: { initialCards: RecentCard[] }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const current = queue[0] ?? null;

  const progressText = useMemo(() => {
    if (initialTotal <= 0 || !current) {
      return "0 / 0";
    }
    return `${initialTotal - queue.length + 1} / ${initialTotal}`;
  }, [initialTotal, queue.length, current]);

  useEffect(() => {
    let active = true;

    const loadQueue = async () => {
      setLoadingQueue(true);
      setQueueError("");
      try {
        const res = await fetch("/api/flashcards/review", { method: "GET" });
        const json = (await res.json()) as QueueResponse;
        if (!active) {
          return;
        }

        if (!res.ok) {
          setQueue([]);
          setInitialTotal(0);
          setQueueError(typeof json.error === "string" ? json.error : "復習キューの取得に失敗しました。");
          return;
        }

        const items = Array.isArray(json.queue) ? json.queue : [];
        setQueue(items);
        setInitialTotal(typeof json.total === "number" ? json.total : items.length);
        setNextDueAt(typeof json.nextDueAt === "string" ? json.nextDueAt : null);
      } catch (error) {
        if (!active) {
          return;
        }
        setQueue([]);
        setInitialTotal(0);
        setQueueError(`復習キューの取得に失敗しました: ${String(error)}`);
      } finally {
        if (active) {
          setLoadingQueue(false);
        }
      }
    };

    void loadQueue();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRevealed(false);
  }, [current?.id]);

  const submitReview = async (remembered: boolean) => {
    if (!current || submitting) {
      return;
    }

    setSubmitting(true);
    setQueueError("");

    try {
      const res = await fetch("/api/flashcards/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flashcardId: current.id,
          remembered
        })
      });
      const json = (await res.json()) as ReviewResponse;

      if (!res.ok || !json.ok) {
        setQueueError(typeof json.error === "string" ? json.error : "復習結果の保存に失敗しました。");
        return;
      }

      setQueue((prev) => prev.slice(1));
      setNextDueAt(typeof json.nextDueAt === "string" ? json.nextDueAt : null);
    } catch (error) {
      setQueueError(`復習結果の保存に失敗しました: ${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const hasCompleted = !loadingQueue && !queueError && queue.length === 0;

  return (
    <div className="grid">
      <section className="panel">
        <h2>フラッシュカード復習</h2>
        {loadingQueue ? <p className="muted">復習キューを読み込み中...</p> : null}
        {queueError ? <p className="muted">{queueError}</p> : null}

        {!loadingQueue && !queueError && current ? (
          <div className="flashcard-review">
            <p className="muted">進捗: {progressText}</p>
            <p className="flashcard-en">{current.en}</p>
            {!revealed ? (
              <button type="button" onClick={() => setRevealed(true)}>
                答えを見る
              </button>
            ) : (
              <>
                <p className="flashcard-ja">{current.ja}</p>
                <div className="flashcard-actions">
                  <button type="button" onClick={() => void submitReview(true)} disabled={submitting}>
                    覚えている
                  </button>
                  <button type="button" className="secondary" onClick={() => void submitReview(false)} disabled={submitting}>
                    覚えていない
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {hasCompleted ? (
          <div className="flashcard-complete">
            <p>今日の復習は完了です。</p>
            <p>
              次回復習予定: <strong>{formatNextDue(nextDueAt)}</strong>
            </p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>フラッシュカード追加</h2>
        <form action="/api/flashcards" method="post" className="grid">
          <label>
            English
            <textarea name="en" required rows={3} />
          </label>
          <label>
            日本語訳（任意）
            <textarea name="ja" rows={2} />
          </label>
          <button type="submit">追加</button>
        </form>
      </section>

      <section className="panel">
        <h2>最近のカード</h2>
        {initialCards.length === 0 ? (
          <p className="muted">まだカードがありません。</p>
        ) : (
          <ul>
            {initialCards.map((card) => (
              <li key={card.id}>
                <p>{card.en}</p>
                <p className="muted">{card.ja}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatNextDue(nextDueAt: string | null) {
  if (!nextDueAt) {
    return "未定";
  }

  const date = new Date(nextDueAt);
  if (Number.isNaN(date.getTime())) {
    return nextDueAt;
  }

  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
