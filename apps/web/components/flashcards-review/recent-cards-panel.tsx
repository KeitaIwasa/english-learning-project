"use client";

import type { RecentCardWithSm2 } from "./shared";
import { formatFlashcardDateTime } from "./shared";

type RecentCardsPanelProps = {
  recentTotal: number;
  searchQuery: string;
  loadingRecent: boolean;
  recentError: string;
  recentCards: RecentCardWithSm2[];
  draftById: Record<string, { en: string; ja: string }>;
  savingById: Record<string, boolean>;
  saveErrorById: Record<string, string>;
  deletingById: Record<string, boolean>;
  expandedSm2: Record<string, boolean>;
  onSearchChange: (value: string) => void;
  onToggleSm2: (cardId: string) => void;
  onDraftChange: (cardId: string, next: { en: string; ja: string }) => void;
  onSaveCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
};

export function RecentCardsPanel(props: RecentCardsPanelProps) {
  return (
    <section className="panel fc-list-panel">
      <div className="fc-section-header">
        <span className="fc-section-icon">📚</span>
        <h2 className="fc-section-title">カード一覧</h2>
        {props.recentTotal > 0 ? <span className="fc-count-badge">{props.recentTotal} 件</span> : null}
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
          value={props.searchQuery}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="English / 日本語で検索..."
          className="fc-search-input"
        />
      </div>

      {props.loadingRecent ? (
        <div className="fc-loading">
          <div className="fc-spinner" />
          <p className="muted">読み込み中...</p>
        </div>
      ) : null}
      {props.recentError ? <p className="fc-error">{props.recentError}</p> : null}

      {!props.loadingRecent && !props.recentError && props.recentCards.length === 0 ? (
        <div className="fc-empty">
          <p className="muted">カードが見つかりません。</p>
        </div>
      ) : null}

      {!props.loadingRecent && !props.recentError && props.recentCards.length > 0 ? (
        <div className="fc-card-list">
          {props.recentCards.map((card) => {
            const draft = props.draftById[card.id] ?? { en: card.en, ja: card.ja };
            const isSaving = Boolean(props.savingById[card.id]);
            const isDeleting = Boolean(props.deletingById[card.id]);
            const saveError = props.saveErrorById[card.id] ?? "";
            const isExpanded = Boolean(props.expandedSm2[card.id]);

            return (
              <article className="fc-list-card" key={card.id}>
                <div className="fc-list-card-header">
                  <span className="fc-list-date">{formatFlashcardDateTime(card.created_at)}</span>
                  <div className="fc-list-header-actions">
                    {isSaving ? (
                      <span className="fc-saving-badge">保存中...</span>
                    ) : !isSaving && saveError ? (
                      <span className="fc-error-badge">{saveError}</span>
                    ) : null}
                    <button type="button" className="fc-sm2-toggle" onClick={() => props.onToggleSm2(card.id)}>
                      {isExpanded ? "▲" : "▼"} SM-2
                    </button>
                    <button
                      type="button"
                      className="fc-delete-btn"
                      onClick={() => props.onDeleteCard(card.id)}
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
                      onChange={(event) =>
                        props.onDraftChange(card.id, {
                          en: event.target.value,
                          ja: draft.ja
                        })
                      }
                      onBlur={() => props.onSaveCard(card.id)}
                      disabled={isDeleting}
                    />
                  </div>
                  <div className="fc-list-field">
                    <span className="fc-list-field-label">🇯🇵</span>
                    <textarea
                      value={draft.ja}
                      rows={2}
                      onChange={(event) =>
                        props.onDraftChange(card.id, {
                          en: draft.en,
                          ja: event.target.value
                        })
                      }
                      onBlur={() => props.onSaveCard(card.id)}
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
                        <span className="fc-sm2-val">{card.sm2 ? formatFlashcardDateTime(card.sm2.nextReviewAt) : "未レビュー"}</span>
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
        <span className="fc-page-info muted">{props.recentTotal} 件</span>
      </div>
    </section>
  );
}
