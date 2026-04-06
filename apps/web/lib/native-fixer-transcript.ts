export type TranscriptSpeaker = 1 | 2 | "unknown";

export type TranscriptTurn = {
  speaker: TranscriptSpeaker;
  text: string;
};

export function buildTranscriptCopyText(params: { transcriptFull: string | null; transcriptTurns: TranscriptTurn[] }): string {
  const turns = params.transcriptTurns
    .map((turn) => {
      const text = String(turn.text ?? "").trim();
      if (!text) {
        return "";
      }
      return `${getTranscriptSpeakerLabel(turn.speaker)}: ${text}`;
    })
    .filter((line) => line.length > 0);

  if (turns.length > 0) {
    return turns.join("\n\n");
  }

  return formatTranscriptForDisplay(String(params.transcriptFull ?? ""));
}

export function formatTranscriptForDisplay(input: string): string {
  const text = String(input ?? "");
  if (!text.trim()) {
    return "";
  }

  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0);

  if (nonEmpty.length === 0) {
    return "";
  }

  // If STT split is too fine-grained (short chunks), merge into readable paragraphs.
  const shortLineCount = nonEmpty.filter((line) => line.length <= 18).length;
  const shortLineRatio = shortLineCount / nonEmpty.length;
  const averageLength = nonEmpty.reduce((sum, line) => sum + line.length, 0) / nonEmpty.length;
  const hasParagraphBreak = lines.some((line) => line.trim().length === 0);
  const shouldMerge =
    shortLineRatio >= 0.45 || nonEmpty.length >= 16 || (hasParagraphBreak && nonEmpty.length >= 3 && averageLength <= 36);
  if (!shouldMerge) {
    return normalized.trim();
  }

  const paragraphs: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    if (current.length === 0) {
      return;
    }
    paragraphs.push(normalizeSpacing(current.join(" ")));
    current = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushCurrent();
      continue;
    }
    current.push(line);
  }
  pushCurrent();

  return paragraphs.join("\n\n").trim();
}

export function getTranscriptSpeakerLabel(speaker: TranscriptSpeaker): string {
  if (speaker === 1) {
    return "Speaker 1";
  }
  if (speaker === 2) {
    return "Speaker 2";
  }
  return "不明話者";
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}
