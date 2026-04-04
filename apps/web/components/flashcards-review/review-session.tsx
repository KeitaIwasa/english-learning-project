"use client";

import type { QueueItem, ReviewSaveError } from "./shared";
import { formatFlashcardDateTime } from "./shared";

type ReviewSessionProps = {
  loadingQueue: boolean;
  queueError: string;
  reviewSaveError: ReviewSaveError | null;
  current: QueueItem | null;
  progressPercent: number;
  progressText: string;
  revealed: boolean;
  hasCompleted: boolean;
  nextDueAt: string | null;
  onReveal: () => void;
  onSubmitReview: (remembered: boolean) => void;
  onRetrySave: () => void;
};

export function ReviewSession(props: ReviewSessionProps) {
  return (
    <section className="panel fc-review-panel">
      <div className="fc-section-header">
        <span className="fc-section-icon">🃏</span>
        <h2 className="fc-section-title">フラッシュカード復習</h2>
      </div>

      {props.loadingQueue ? (
        <div className="fc-loading">
          <div className="fc-spinner" />
          <p className="muted">復習キューを読み込み中...</p>
        </div>
      ) : null}

      {props.queueError ? <p className="fc-error">{props.queueError}</p> : null}
      {props.reviewSaveError ? (
        <div className="fc-error fc-review-save-error" role="alert">
          <span>{props.reviewSaveError.message}</span>
          <button type="button" className="fc-review-retry-btn" onClick={props.onRetrySave}>
            再送
          </button>
        </div>
      ) : null}

      {!props.loadingQueue && !props.queueError && props.current ? (
        <div className="fc-review">
          <div className="fc-progress">
            <div className="fc-progress-bar-wrap">
              <div className="fc-progress-bar-fill" style={{ width: `${props.progressPercent}%` }} />
            </div>
            <span className="fc-progress-label">{props.progressText}</span>
          </div>

          <div className={`fc-card ${props.revealed ? "fc-card--revealed" : ""}`}>
            <div className="fc-card-inner">
              <div className="fc-card-face fc-card-front">
                <p className="fc-card-lang-badge">🇯🇵 日本語</p>
                <p className="fc-card-ja">{props.current.ja}</p>
                {!props.revealed ? (
                  <button type="button" className="fc-reveal-btn" onClick={props.onReveal}>
                    答えを見る
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                ) : null}
              </div>

              {props.revealed ? (
                <div className="fc-card-face fc-card-back">
                  <p className="fc-card-lang-badge">🇬🇧 English</p>
                  <p className="fc-card-en">{props.current.en}</p>
                  <div className="fc-answer-actions">
                    <button type="button" className="fc-btn-remembered" onClick={() => props.onSubmitReview(true)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      覚えている
                    </button>
                    <button type="button" className="fc-btn-forgot" onClick={() => props.onSubmitReview(false)}>
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

      {props.hasCompleted ? (
        <div className="fc-complete">
          <div className="fc-complete-icon">🎉</div>
          <p className="fc-complete-title">今日の復習は完了です！</p>
          <p className="muted">
            次回復習予定: <strong>{formatFlashcardDateTime(props.nextDueAt)}</strong>
          </p>
        </div>
      ) : null}
    </section>
  );
}
