"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useState } from "react";

export type ChatMode = "translate" | "ask" | "add_flashcard";

export type ChatHistoryMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  mode: ChatMode;
  content: string;
  created_at: string;
};

type ChatHistoryResponse = {
  messages?: ChatHistoryMessage[];
  hasMore?: boolean;
  nextBefore?: string | null;
  error?: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode: ChatMode;
  corrections?: string[];
  reviewHints?: string[];
};

const HISTORY_PAGE_SIZE = 10;

function mapHistoryToUiMessages(historyMessages: ChatHistoryMessage[]) {
  return historyMessages
    .filter((item): item is ChatHistoryMessage & { role: "user" | "assistant" } => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: item.id,
      role: item.role,
      text: item.content,
      mode: item.mode
    }));
}

export function useChatHistory(params: {
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollToTimelineBottom: () => void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [nextBeforeCursor, setNextBeforeCursor] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      try {
        const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
        const res = await fetch(`/api/chat?${query.toString()}`, { method: "GET" });
        const json = (await res.json()) as ChatHistoryResponse;
        if (!active) {
          return;
        }
        if (!res.ok) {
          setMessages([]);
          setHasMoreHistory(false);
          setNextBeforeCursor(null);
          return;
        }

        setMessages(mapHistoryToUiMessages(json.messages ?? []));
        setHasMoreHistory(Boolean(json.hasMore));
        setNextBeforeCursor(json.nextBefore ?? null);
        setChatId((json.messages ?? []).at(-1)?.thread_id ?? null);
      } catch {
        if (active) {
          setMessages([]);
          setHasMoreHistory(false);
          setNextBeforeCursor(null);
          setChatId(null);
        }
      } finally {
        if (active) {
          setLoadingHistory(false);
          requestAnimationFrame(params.scrollToTimelineBottom);
        }
      }
    };

    void loadHistory();

    return () => {
      active = false;
    };
  }, [params.scrollToTimelineBottom]);

  const loadMoreHistory = useCallback(async () => {
    if (loadingMoreHistory || loadingHistory || !hasMoreHistory || !nextBeforeCursor) {
      return false;
    }

    const timeline = params.timelineRef.current;
    const previousHeight = timeline?.scrollHeight ?? 0;
    const previousTop = timeline?.scrollTop ?? 0;
    setLoadingMoreHistory(true);

    try {
      const query = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        before: nextBeforeCursor
      });
      const res = await fetch(`/api/chat?${query.toString()}`, { method: "GET" });
      const json = (await res.json()) as ChatHistoryResponse;

      if (!res.ok) {
        return false;
      }

      const olderHistory = mapHistoryToUiMessages(json.messages ?? []);
      setMessages((prev) => [...olderHistory, ...prev]);
      setHasMoreHistory(Boolean(json.hasMore));
      setNextBeforeCursor(json.nextBefore ?? null);

      requestAnimationFrame(() => {
        const element = params.timelineRef.current;
        if (!element) {
          return;
        }
        const nextHeight = element.scrollHeight;
        element.scrollTo({ top: previousTop + (nextHeight - previousHeight), behavior: "auto" });
      });

      return true;
    } finally {
      setLoadingMoreHistory(false);
    }
  }, [hasMoreHistory, loadingHistory, loadingMoreHistory, nextBeforeCursor, params.timelineRef]);

  return {
    messages,
    setMessages,
    loadingHistory,
    loadingMoreHistory,
    hasMoreHistory,
    chatId,
    setChatId,
    loadMoreHistory
  };
}
