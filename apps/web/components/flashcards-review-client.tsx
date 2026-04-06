"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRecentCards, fetchReviewQueue, removeRecentCard, submitReviewResult, updateRecentCard } from "@/components/flashcards-review/api";
import { RecentCardsPanel } from "@/components/flashcards-review/recent-cards-panel";
import { ReviewSession } from "@/components/flashcards-review/review-session";
import type { QueueItem, RecentCardWithSm2, ReviewAttempt, ReviewSaveError } from "@/components/flashcards-review/shared";

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
  const [addingCard, setAddingCard] = useState(false);
  const [addCardError, setAddCardError] = useState("");

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
        const { res, json } = await fetchReviewQueue();
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
        const { res, json } = await fetchRecentCards({
          query: debouncedQuery,
          limit: LIST_LIMIT
        });

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
      return false;
    }

    inFlightReviewIdsRef.current.add(attempt.flashcardId);

    try {
      const { res, json } = await submitReviewResult({
        flashcardId: attempt.flashcardId,
        remembered: attempt.remembered
      });

      if (!res.ok || !json.ok) {
        setQueue((prev) => {
          if (prev.some((item) => item.id === attempt.flashcardId)) {
            return prev;
          }
          return [attempt.card, ...prev];
        });
        setReviewSaveError({
          message: typeof json.error === "string" ? json.error : "復習結果の保存に失敗しました。",
          attempt
        });
        return false;
      }
      if (typeof json.nextDueAt === "string" || json.nextDueAt === null) {
        setNextDueAt(json.nextDueAt);
      }
      return true;
    } catch (error) {
      setQueue((prev) => {
        if (prev.some((item) => item.id === attempt.flashcardId)) {
          return prev;
        }
        return [attempt.card, ...prev];
      });
      setReviewSaveError({
        message: `復習結果の保存に失敗しました: ${String(error)}`,
        attempt
      });
      return false;
    } finally {
      inFlightReviewIdsRef.current.delete(attempt.flashcardId);
    }
  };

  const submitReview = (remembered: boolean) => {
    if (!current) {
      return;
    }

    const attempt: ReviewAttempt = { flashcardId: current.id, remembered, card: current };
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
      const { res, json } = await updateRecentCard({
        id: cardId,
        en: nextEn,
        ja: nextJa
      });

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
      const { res, json } = await removeRecentCard(cardId);

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

  const submitAddCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addingCard) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const en = String(formData.get("en") ?? "").trim();
    const ja = String(formData.get("ja") ?? "").trim();

    if (!en) {
      setAddCardError("English は必須です。");
      return;
    }

    formData.set("en", en);
    formData.set("ja", ja);

    setAddingCard(true);
    setAddCardError("");

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json"
        }
      });
      const json = (await response.json()) as {
        ok?: boolean;
        error?: unknown;
      };

      if (!response.ok || !json.ok) {
        setAddCardError(typeof json.error === "string" ? json.error : "カード追加に失敗しました。");
        return;
      }

      form.reset();
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      setAddCardError(`カード追加に失敗しました: ${String(error)}`);
    } finally {
      setAddingCard(false);
    }
  };

  return (
    <div className="fc-page">
      <ReviewSession
        loadingQueue={loadingQueue}
        queueError={queueError}
        reviewSaveError={reviewSaveError}
        current={current}
        progressPercent={progressPercent}
        progressText={progressText}
        revealed={revealed}
        hasCompleted={hasCompleted}
        nextDueAt={nextDueAt}
        onReveal={() => setRevealed(true)}
        onSubmitReview={submitReview}
        onRetrySave={retrySaveReview}
      />

      {/* ── 追加セクション ── */}
      <section className="panel fc-add-panel">
        <div className="fc-section-header">
          <span className="fc-section-icon">➕</span>
          <h2 className="fc-section-title">カードを追加</h2>
        </div>
        <form action="/api/flashcards" method="post" className="fc-add-form" onSubmit={submitAddCard}>
          <div className="fc-field">
            <label className="fc-label" htmlFor="fc-add-en">
              🇬🇧 English
            </label>
            <textarea id="fc-add-en" name="en" required rows={3} placeholder="英語フレーズを入力..." disabled={addingCard} />
          </div>
          <div className="fc-field">
            <label className="fc-label" htmlFor="fc-add-ja">
              🇯🇵 日本語訳（任意）
            </label>
            <textarea id="fc-add-ja" name="ja" rows={2} placeholder="日本語訳を入力..." disabled={addingCard} />
          </div>
          {addCardError ? <p className="fc-error">{addCardError}</p> : null}
          <button type="submit" className="fc-add-btn" disabled={addingCard}>
            {addingCard ? (
              <>
                <span className="fc-spinner fc-spinner--sm fc-spinner--invert" aria-hidden="true" />
                追加中...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                カードを追加
              </>
            )}
          </button>
        </form>
      </section>

      <RecentCardsPanel
        recentTotal={recentTotal}
        searchQuery={searchQuery}
        loadingRecent={loadingRecent}
        recentError={recentError}
        recentCards={recentCards}
        draftById={draftById}
        savingById={savingById}
        saveErrorById={saveErrorById}
        deletingById={deletingById}
        expandedSm2={expandedSm2}
        onSearchChange={setSearchQuery}
        onToggleSm2={(cardId) => setExpandedSm2((prev) => ({ ...prev, [cardId]: !prev[cardId] }))}
        onDraftChange={(cardId, next) => setDraftById((prev) => ({ ...prev, [cardId]: next }))}
        onSaveCard={(cardId) => {
          void saveCardIfNeeded(cardId);
        }}
        onDeleteCard={(cardId) => {
          void deleteCard(cardId);
        }}
      />
    </div>
  );
}
