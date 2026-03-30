"use client";

import type { KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { HistoryItem, JobStatus, ViewMode } from "./shared";
import { formatNativeFixerDateTime } from "./shared";

type NativeFixerHistorySidebarProps = {
  loadingList: boolean;
  items: HistoryItem[];
  selectedId: string | null;
  viewMode: ViewMode;
  isHistoryOpenOnMobile: boolean;
  titleEditingId: string | null;
  titleDraft: string;
  onToggleMobile: () => void;
  onCreateNew: () => void;
  onSelectHistory: (itemId: string) => void;
  onOpenEditTitle: (item: HistoryItem) => void;
  onTitleDraftChange: (value: string) => void;
  onSubmitTitle: (itemId: string) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>, itemId: string) => void;
};

export function NativeFixerHistorySidebar(props: NativeFixerHistorySidebarProps) {
  return (
    <aside className="panel nfx-sidebar">
      <div className="nfx-sidebar-heading">
        <div className="nfx-sidebar-heading-left">
          <h2 className="nfx-sidebar-title">解析履歴</h2>
          <button
            type="button"
            className="secondary nfx-history-toggle"
            aria-label="履歴パネルを開閉"
            aria-expanded={props.isHistoryOpenOnMobile}
            aria-controls="nfx-history-panel"
            onClick={props.onToggleMobile}
          >
            <ChevronDown size={16} />
          </button>
        </div>
        {props.viewMode === "history" ? (
          <button type="button" className="secondary nfx-new-upload-btn" onClick={props.onCreateNew}>
            新規追加
          </button>
        ) : null}
      </div>
      <div id="nfx-history-panel" className={`nfx-sidebar-body${props.isHistoryOpenOnMobile ? " open" : ""}`}>
        {props.loadingList ? <p className="muted">読み込み中...</p> : null}
        {!props.loadingList && props.items.length === 0 ? <p className="muted">まだ履歴がありません。</p> : null}

        <div className="nfx-history-list">
          {props.items.map((item) => {
            const active = item.id === props.selectedId;
            const title = item.customTitle || item.fileName;
            return (
              <button
                type="button"
                key={item.id}
                className={`nfx-history-item${active ? " active" : ""}`}
                onClick={() => props.onSelectHistory(item.id)}
              >
                <div className="nfx-history-item-top">
                  {props.titleEditingId === item.id ? (
                    <input
                      value={props.titleDraft}
                      autoFocus
                      onChange={(event) => props.onTitleDraftChange(event.target.value)}
                      onBlur={() => props.onSubmitTitle(item.id)}
                      onKeyDown={(event) => props.onTitleKeyDown(event, item.id)}
                    />
                  ) : (
                    <strong
                      className="nfx-history-title"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onOpenEditTitle(item);
                      }}
                    >
                      {title}
                    </strong>
                  )}
                  <NativeFixerStatusBadge status={item.status} />
                </div>
                <span className="nfx-history-date">{formatNativeFixerDateTime(item.completedAt || item.createdAt)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function NativeFixerStatusBadge({ status }: { status: JobStatus }) {
  const label = status === "completed" ? "完了" : status === "failed" ? "失敗" : "解析中";
  return <span className={`nfx-status ${status}`}>{label}</span>;
}
