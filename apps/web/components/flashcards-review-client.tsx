"use client";

import { useEffect, useMemo, useState } from "react";

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

type Sm2Info = {
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  reviewedAt: string;
};

type RecentCardWithSm2 = {
  id: string;
  en: string;
  ja: string;
  created_at: string;
  updated_at: string;
  sm2: Sm2Info | null;
};

type RecentCardsResponse = {
  items?: RecentCardWithSm2[];
  total?: number;
  limit?: number;
  offset?: number;
  error?: string;
};

const PAGE_SIZE = 20;

export function FlashcardsReviewClient() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentCards, setRecentCards] = useState<RecentCardWithSm2[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentOffset, setRecentOffset] = useState(0);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState("");
  const [draftById, setDraftById] = useState<Record<string, { en: string; ja: string }>>({});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [saveErrorById, setSaveErrorById] = useState<Record<string, string>>({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setRecentOffset(0);
  }, [debouncedQuery]);

  useEffect(() => {
    let active = true;

    const loadRecentCards = async () => {
      setLoadingRecent(true);
      setRecentError("");
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          limit: String(PAGE_SIZE),
          offset: String(recentOffset)
        });

        const res = await fetch(`/api/flashcards/manage?${params.toString()}`, { method: "GET" });
        const json = (await res.json()) as RecentCardsResponse;

        if (!active) {
          return;
        }

        if (!res.ok) {
          setRecentCards([]);
          setRecentTotal(0);
          setRecentError(typeof json.error === "string" ? json.error : "カード一覧の取得に失敗しました。");
          return;
        }

        const items = Array.isArray(json.items) ? json.items : [];
        setRecentCards(items);
        setRecentTotal(typeof json.total === "number" ? json.total : items.length);
        const nextDrafts: Record<string, { en: string; ja: string }> = {};
        for (const item of items) {
          nextDrafts[item.id] = { en: item.en, ja: item.ja };
        }
        setDraftById(nextDrafts);
      } catch (error) {
        if (!active) {
          return;
        }
        setRecentCards([]);
        setRecentTotal(0);
        setRecentError(`カード一覧の取得に失敗しました: ${String(error)}`);
      } finally {
        if (active) {
          setLoadingRecent(false);
        }
      }
    };

    void loadRecentCards();

    return () => {
      active = false;
    };
  }, [debouncedQuery, recentOffset, refreshKey]);

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

  const hasPrev = recentOffset > 0;
  const hasNext = recentOffset + recentCards.length < recentTotal;

  const saveCardIfNeeded = async (cardId: string) => {
    const card = recentCards.find((item) => item.id === cardId);
    const draft = draftById[cardId];
    if (!card || !draft) {
      return;
    }

    if (savingById[cardId] || deletingById[cardId]) {
      return;
    }

    const nextEn = draft.en.trim();
    const nextJa = draft.ja.trim();

    if (!nextEn) {
      setSaveErrorById((prev) => ({ ...prev, [cardId]: "English は必須です。" }));
      return;
    }

    if (nextEn === card.en && nextJa === card.ja) {
      if (draft.en !== nextEn || draft.ja !== nextJa) {
        setDraftById((prev) => ({ ...prev, [cardId]: { en: nextEn, ja: nextJa } }));
      }
      return;
    }

    setSavingById((prev) => ({ ...prev, [cardId]: true }));
    setSaveErrorById((prev) => ({ ...prev, [cardId]: "" }));

    try {
      const res = await fetch("/api/flashcards/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cardId,
          en: nextEn,
          ja: nextJa
        })
      });
      const json = (await res.json()) as {
        ok?: boolean;
        item?: { id: string; en: string; ja: string; updated_at: string };
        error?: string;
      };

      if (!res.ok || !json.ok || !json.item) {
        setSaveErrorById((prev) => ({
          ...prev,
          [cardId]: typeof json.error === "string" ? json.error : "保存に失敗しました。"
        }));
        return;
      }

      setRecentCards((prev) =>
        prev.map((item) =>
          item.id === cardId
            ? {
                ...item,
                en: json.item?.en ?? item.en,
                ja: json.item?.ja ?? item.ja,
                updated_at: json.item?.updated_at ?? item.updated_at
              }
            : item
        )
      );
      setDraftById((prev) => ({ ...prev, [cardId]: { en: nextEn, ja: nextJa } }));
      setSaveErrorById((prev) => ({ ...prev, [cardId]: "" }));
    } catch (error) {
      setSaveErrorById((prev) => ({ ...prev, [cardId]: `保存に失敗しました: ${String(error)}` }));
    } finally {
      setSavingById((prev) => ({ ...prev, [cardId]: false }));
    }
  };

  const deleteCard = async (cardId: string) => {
    if (deletingById[cardId] || savingById[cardId]) {
      return;
    }

    const confirmed = window.confirm("このカードを削除しますか？");
    if (!confirmed) {
      return;
    }

    setDeletingById((prev) => ({ ...prev, [cardId]: true }));
    setRecentError("");

    try {
      const res = await fetch("/api/flashcards/manage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cardId })
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !json.ok) {
        setRecentError(typeof json.error === "string" ? json.error : "削除に失敗しました。");
        return;
      }

      const nextTotal = Math.max(0, recentTotal - 1);
      if (recentOffset > 0 && recentOffset >= nextTotal) {
        setRecentOffset(Math.max(0, recentOffset - PAGE_SIZE));
      } else {
        setRefreshKey((prev) => prev + 1);
      }
    } catch (error) {
      setRecentError(`削除に失敗しました: ${String(error)}`);
    } finally {
      setDeletingById((prev) => ({ ...prev, [cardId]: false }));
    }
  };

  return (
    <div className="grid">
      <section className="panel">
        <h2>フラッシュカード復習</h2>
        {loadingQueue ? <p className="muted">復習キューを読み込み中...</p> : null}
        {queueError ? <p className="muted">{queueError}</p> : null}

        {!loadingQueue && !queueError && current ? (
          <div className="flashcard-review">
            <p className="muted">進捗: {progressText}</p>
            <p className="flashcard-ja">{current.ja}</p>
            {!revealed ? (
              <button type="button" onClick={() => setRevealed(true)}>
                答えを見る
              </button>
            ) : (
              <>
                <p className="flashcard-en">{current.en}</p>
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
              次回復習予定: <strong>{formatDateTime(nextDueAt)}</strong>
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
        <div className="recent-search">
          <label htmlFor="recent-card-search">検索</label>
          <input
            id="recent-card-search"
            name="recent-card-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="English / 日本語で検索"
          />
        </div>

        {loadingRecent ? <p className="muted">カード一覧を読み込み中...</p> : null}
        {recentError ? <p className="muted">{recentError}</p> : null}

        {!loadingRecent && !recentError && recentCards.length === 0 ? <p className="muted">カードが見つかりません。</p> : null}

        {!loadingRecent && !recentError && recentCards.length > 0 ? (
          <div className="recent-card-list">
            {recentCards.map((card) => {
              const draft = draftById[card.id] ?? { en: card.en, ja: card.ja };
              const isSaving = Boolean(savingById[card.id]);
              const isDeleting = Boolean(deletingById[card.id]);
              const saveError = saveErrorById[card.id] ?? "";

              return (
                <article className="recent-card" key={card.id}>
                  <div className="recent-card-header">
                    <p className="muted">作成日: {formatDateTime(card.created_at)}</p>
                    <button type="button" className="secondary" onClick={() => void deleteCard(card.id)} disabled={isSaving || isDeleting}>
                      {isDeleting ? "削除中..." : "削除"}
                    </button>
                  </div>

                  <div className="recent-card-fields">
                    <label>
                      English
                      <textarea
                        value={draft.en}
                        rows={2}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftById((prev) => ({
                            ...prev,
                            [card.id]: { ...prev[card.id], en: value, ja: prev[card.id]?.ja ?? card.ja }
                          }));
                        }}
                        onBlur={() => {
                          void saveCardIfNeeded(card.id);
                        }}
                        disabled={isDeleting}
                      />
                    </label>
                    <label>
                      日本語
                      <textarea
                        value={draft.ja}
                        rows={2}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftById((prev) => ({
                            ...prev,
                            [card.id]: { en: prev[card.id]?.en ?? card.en, ja: value }
                          }));
                        }}
                        onBlur={() => {
                          void saveCardIfNeeded(card.id);
                        }}
                        disabled={isDeleting}
                      />
                    </label>
                  </div>

                  <div className="recent-card-sm2">
                    <p>
                      <strong>Repetition:</strong> {card.sm2 ? card.sm2.repetition : "未レビュー"}
                    </p>
                    <p>
                      <strong>Interval(days):</strong> {card.sm2 ? card.sm2.intervalDays : "未レビュー"}
                    </p>
                    <p>
                      <strong>Ease factor:</strong> {card.sm2 ? card.sm2.easeFactor.toFixed(2) : "未レビュー"}
                    </p>
                    <p>
                      <strong>Next review:</strong> {card.sm2 ? formatDateTime(card.sm2.nextReviewAt) : "未レビュー"}
                    </p>
                  </div>

                  <div className="recent-card-actions">
                    {isSaving ? <p className="muted">保存中...</p> : null}
                    {!isSaving && saveError ? <p className="muted">{saveError}</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        <div className="pagination-row">
          <button type="button" className="secondary" onClick={() => setRecentOffset((prev) => Math.max(0, prev - PAGE_SIZE))} disabled={loadingRecent || !hasPrev}>
            前へ
          </button>
          <p className="muted">
            {recentTotal === 0 ? "0 件" : `${recentOffset + 1}-${Math.min(recentOffset + recentCards.length, recentTotal)} / ${recentTotal} 件`}
          </p>
          <button type="button" className="secondary" onClick={() => setRecentOffset((prev) => prev + PAGE_SIZE)} disabled={loadingRecent || !hasNext}>
            次へ
          </button>
        </div>
      </section>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "未定";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
