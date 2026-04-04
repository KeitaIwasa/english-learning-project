"use client";

import type { QueueResponse, RecentCardsResponse, ReviewResponse } from "./shared";

export async function fetchReviewQueue() {
  const res = await fetch("/api/flashcards/review", { method: "GET" });
  const json = (await res.json()) as QueueResponse;
  return { res, json };
}

export async function submitReviewResult(params: { flashcardId: string; remembered: boolean }) {
  const res = await fetch("/api/flashcards/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const json = (await res.json()) as ReviewResponse;
  return { res, json };
}

export async function fetchRecentCards(params: { query: string; limit: number }) {
  const query = new URLSearchParams({
    q: params.query,
    limit: String(params.limit)
  });
  const res = await fetch(`/api/flashcards/manage?${query.toString()}`, { method: "GET" });
  const json = (await res.json()) as RecentCardsResponse;
  return { res, json };
}

export async function updateRecentCard(params: { id: string; en: string; ja: string }) {
  const res = await fetch("/api/flashcards/manage", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const json = (await res.json()) as {
    ok?: boolean;
    item?: { id: string; en: string; ja: string; updated_at: string };
    error?: string;
  };
  return { res, json };
}

export async function removeRecentCard(id: string) {
  const res = await fetch("/api/flashcards/manage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  return { res, json };
}
