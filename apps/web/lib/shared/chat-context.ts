export type AskContextRow = {
  role: string;
  content: string;
};

export type AskContextTurn = {
  role: "user" | "model";
  text: string;
};

function truncateKeepTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(-maxChars);
  }
  return `...${text.slice(-(maxChars - 3))}`;
}

export function buildAskContextTurns(params: {
  rows: AskContextRow[];
  latestMessage: string;
  maxHistoryTurns: number;
  maxTotalChars: number;
}): AskContextTurn[] {
  const normalized = params.rows
    .map((row) => ({
      role: row.role === "assistant" ? ("model" as const) : ("user" as const),
      text: String(row.content ?? "").trim()
    }))
    .filter((turn) => turn.text.length > 0);

  normalized.push({
    role: "user",
    text: params.latestMessage
  });

  const maxMessages = params.maxHistoryTurns * 2 + 1;
  const recent = normalized.slice(-maxMessages);
  if (recent.length === 0) {
    return [];
  }

  const perMessageBudget = Math.max(1, Math.floor(params.maxTotalChars / recent.length));
  const truncated = recent.map((turn) => ({
    role: turn.role,
    text: truncateKeepTail(turn.text, perMessageBudget)
  }));

  const merged: AskContextTurn[] = [];
  for (const turn of truncated) {
    const last = merged.at(-1);
    if (last && last.role === turn.role) {
      last.text = `${last.text}\n${turn.text}`;
      continue;
    }
    merged.push(turn);
  }

  return merged;
}
