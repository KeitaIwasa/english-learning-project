"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  flashcardId?: string;
  nextDueAt?: string | null;
  error?: string;
};

type ReviewAttempt = {
  flashcardId: string;
  remembered: boolean;
};

type ReviewSaveError = {
  message: string;
  attempt: ReviewAttempt;
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

const LIST_LIMIT = 100;

export function FlashcardsReviewClient() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueLoadCompleted, setQueueLoadCompleted] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [reviewSaveError, setReviewSaveError] = useState<ReviewSaveError | null>(null);
  const inFlightReviewIdsRef = useRef(new Set<string>());

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentCards, setRecentCards] = useState<RecentCardWithSm2[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState("");
  const [draftById, setDraftById] = useState<Record<string, { en: string; ja: string }>>({});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [saveErrorById, setSaveErrorById] = useState<Record<string, string>>({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [expandedSm2, setExpandedSm2] = useState<Record<string, boolean>>({});

  const current = queue[0] ?? null;

  const progressPercent = useMemo(() => {
    if (initialTotal <= 0) return 0;
    return Math.round(((initialTotal - queue.length) / initialTotal) * 100);
  }, [initialTotal, queue.length]);

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
          setQueueLoadCompleted(true);
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
    if (!queueLoadCompleted) {
      return;
    }

    let active = true;

    const loadRecentCards = async () => {
      setLoadingRecent(true);
      setRecentError("");
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          limit: String(LIST_LIMIT)
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
  }, [debouncedQuery, queueLoadCompleted, refreshKey]);

  const persistReview = async (attempt: ReviewAttempt) => {
    if (inFlightReviewIdsRef.current.has(attempt.flashcardId)) {
      return;
    }

    inFlightReviewIdsRef.current.add(attempt.flashcardId);

    try {
      const res = await fetch("/api/flashcards/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flashcardId: attempt.flashcardId,
          remembered: attempt.remembered
        })
      });
      const json = (await res.json()) as ReviewResponse;

      if (!res.ok || !json.ok) {
        setReviewSaveError({
          message: typeof json.error === "string" ? json.error : "復習結果の保存に失敗しました。",
          attempt
        });
        return;
      }
      setNextDueAt(typeof json.nextDueAt === "string" ? json.nextDueAt : null);
    } catch (error) {
      setReviewSaveError({
        message: `復習結果の保存に失敗しました: ${String(error)}`,
        attempt
      });
    } finally {
      inFlightReviewIdsRef.current.delete(attempt.flashcardId);
    }
  };

  const submitReview = (remembered: boolean) => {
    if (!current) {
      return;
    }

    const attempt: ReviewAttempt = { flashcardId: current.id, remembered };
    if (inFlightReviewIdsRef.current.has(attempt.flashcardId)) {
      return;
    }

    setQueueError("");
    setReviewSaveError(null);
    setQueue((prev) => prev.slice(1));
    void persistReview(attempt);
  };

  const retrySaveReview = () => {
    if (!reviewSaveError) {
      return;
    }
    setReviewSaveError(null);
    void persistReview(reviewSaveError.attempt);
  };

  const hasCompleted = !loadingQueue && !queueError && queue.length === 0;

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

      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      setRecentError(`削除に失敗しました: ${String(error)}`);
    } finally {
      setDeletingById((prev) => ({ ...prev, [cardId]: false }));
    }
  };

  return (
    <div className="fc-page">
      {/* ── 復習セクション ── */}
      <section className="panel fc-review-panel">
        <div className="fc-section-header">
          <span className="fc-section-icon">🃏</span>
          <h2 className="fc-section-title">フラッシュカード復習</h2>
        </div>

        {loadingQueue ? (
          <div className="fc-loading">
            <div className="fc-spinner" />
            <p className="muted">復習キューを読み込み中...</p>
          </div>
        ) : null}

        {queueError ? <p className="fc-error">{queueError}</p> : null}
        {reviewSaveError ? (
          <div className="fc-error fc-review-save-error" role="alert">
            <span>{reviewSaveError.message}</span>
            <button type="button" className="fc-review-retry-btn" onClick={retrySaveReview}>
              再送
            </button>
          </div>
        ) : null}

        {!loadingQueue && !queueError && current ? (
          <div className="fc-review">
            {/* 進捗バー */}
            <div className="fc-progress">
              <div className="fc-progress-bar-wrap">
                <div className="fc-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="fc-progress-label">{progressText}</span>
            </div>

            {/* カード */}
            <div className={`fc-card ${revealed ? "fc-card--revealed" : ""}`}>
              <div className="fc-card-inner">
                {/* 表面（日本語） */}
                <div className="fc-card-face fc-card-front">
                  <p className="fc-card-lang-badge">🇯🇵 日本語</p>
                  <p className="fc-card-ja">{current.ja}</p>
                  {!revealed ? (
                    <button type="button" className="fc-reveal-btn" onClick={() => setRevealed(true)}>
                      答えを見る
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {/* 裏面（英語） */}
                {revealed ? (
                  <div className="fc-card-face fc-card-back">
                    <p className="fc-card-lang-badge">🇬🇧 English</p>
                    <p className="fc-card-en">{current.en}</p>
                    <div className="fc-answer-actions">
                      <button
                        type="button"
                        className="fc-btn-remembered"
                        onClick={() => submitReview(true)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        覚えている
                      </button>
                      <button
                        type="button"
                        className="fc-btn-forgot"
                        onClick={() => submitReview(false)}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        覚えていない
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {hasCompleted ? (
          <div className="fc-complete">
            <div className="fc-complete-icon">🎉</div>
            <p className="fc-complete-title">今日の復習は完了です！</p>
            <p className="muted">
              次回復習予定: <strong>{formatDateTime(nextDueAt)}</strong>
            </p>
          </div>
        ) : null}
      </section>

      {/* ── 追加セクション ── */}
      <section className="panel fc-add-panel">
        <div className="fc-section-header">
          <span className="fc-section-icon">➕</span>
          <h2 className="fc-section-title">カードを追加</h2>
        </div>
        <form action="/api/flashcards" method="post" className="fc-add-form">
          <div className="fc-field">
            <label className="fc-label" htmlFor="fc-add-en">
              🇬🇧 English
            </label>
            <textarea id="fc-add-en" name="en" required rows={3} placeholder="英語フレーズを入力..." />
          </div>
          <div className="fc-field">
            <label className="fc-label" htmlFor="fc-add-ja">
              🇯🇵 日本語訳（任意）
            </label>
            <textarea id="fc-add-ja" name="ja" rows={2} placeholder="日本語訳を入力..." />
          </div>
          <button type="submit" className="fc-add-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            カードを追加
          </button>
        </form>
      </section>

      {/* ── 最近のカードセクション ── */}
      <section className="panel fc-list-panel">
        <div className="fc-section-header">
          <span className="fc-section-icon">📚</span>
          <h2 className="fc-section-title">カード一覧</h2>
          {recentTotal > 0 ? <span className="fc-count-badge">{recentTotal} 件</span> : null}
        </div>

        <div className="fc-search-wrap">
          <svg className="fc-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="recent-card-search"
            name="recent-card-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="English / 日本語で検索..."
            className="fc-search-input"
          />
        </div>

        {loadingRecent ? (
          <div className="fc-loading">
            <div className="fc-spinner" />
            <p className="muted">読み込み中...</p>
          </div>
        ) : null}
        {recentError ? <p className="fc-error">{recentError}</p> : null}

        {!loadingRecent && !recentError && recentCards.length === 0 ? (
          <div className="fc-empty">
            <p className="muted">カードが見つかりません。</p>
          </div>
        ) : null}

        {!loadingRecent && !recentError && recentCards.length > 0 ? (
          <div className="fc-card-list">
            {recentCards.map((card) => {
              const draft = draftById[card.id] ?? { en: card.en, ja: card.ja };
              const isSaving = Boolean(savingById[card.id]);
              const isDeleting = Boolean(deletingById[card.id]);
              const saveError = saveErrorById[card.id] ?? "";
              const isExpanded = Boolean(expandedSm2[card.id]);

              return (
                <article className="fc-list-card" key={card.id}>
                  <div className="fc-list-card-header">
                    <span className="fc-list-date">{formatDateTime(card.created_at)}</span>
                    <div className="fc-list-header-actions">
                      {isSaving ? (
                        <span className="fc-saving-badge">保存中...</span>
                      ) : !isSaving && saveError ? (
                        <span className="fc-error-badge">{saveError}</span>
                      ) : null}
                      <button
                        type="button"
                        className="fc-sm2-toggle"
                        onClick={() => setExpandedSm2((prev) => ({ ...prev, [card.id]: !prev[card.id] }))}
                      >
                        {isExpanded ? "▲" : "▼"} SM-2
                      </button>
                      <button
                        type="button"
                        className="fc-delete-btn"
                        onClick={() => void deleteCard(card.id)}
                        disabled={isSaving || isDeleting}
                        title="削除"
                        aria-label="削除"
                      >
                        {isDeleting ? (
                          <div className="fc-spinner fc-spinner--sm" />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="fc-list-fields">
                    <div className="fc-list-field">
                      <span className="fc-list-field-label">🇬🇧</span>
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
                    </div>
                    <div className="fc-list-field">
                      <span className="fc-list-field-label">🇯🇵</span>
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
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="fc-sm2-info">
                      <div className="fc-sm2-grid">
                        <div className="fc-sm2-item">
                          <span className="fc-sm2-key">繰り返し回数</span>
                          <span className="fc-sm2-val">{card.sm2 ? card.sm2.repetition : "—"}</span>
                        </div>
                        <div className="fc-sm2-item">
                          <span className="fc-sm2-key">間隔 (日)</span>
                          <span className="fc-sm2-val">{card.sm2 ? card.sm2.intervalDays : "—"}</span>
                        </div>
                        <div className="fc-sm2-item">
                          <span className="fc-sm2-key">Ease</span>
                          <span className="fc-sm2-val">{card.sm2 ? card.sm2.easeFactor.toFixed(2) : "—"}</span>
                        </div>
                        <div className="fc-sm2-item">
                          <span className="fc-sm2-key">次回復習</span>
                          <span className="fc-sm2-val">{card.sm2 ? formatDateTime(card.sm2.nextReviewAt) : "未レビュー"}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}

        <div className="fc-pagination">
          <span className="fc-page-info muted">{recentTotal} 件</span>
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
