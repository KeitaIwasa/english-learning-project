import { generateWithGemini } from "./gemini.ts";
import { appEnv } from "./env.ts";
import type { SpeechDiarizedTurn } from "./google-cloud.ts";

export type SpeechFixSpeaker = 1 | 2 | "unknown";

export type SpeechFixCorrection = {
  index: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
  speaker: SpeechFixSpeaker;
  addedFlashcardId: string | null;
};

export async function buildSpeechFixCorrections(params: {
  transcript: string;
  transcriptTurns?: SpeechDiarizedTurn[];
}): Promise<SpeechFixCorrection[]> {
  const text = String(params.transcript ?? "").trim();
  if (!text) {
    return [];
  }

  const transcriptTurns = (params.transcriptTurns ?? []).filter((item) => String(item?.text ?? "").trim().length > 0);
  const speakerAwareInput = buildSpeakerAwareInput(text, transcriptTurns);

  const response = await generateWithGemini({
    model: appEnv.geminiReasoningModel(),
    instruction: [
      "あなたは英語添削の専門家です。",
      "入力された英語の文字起こし文から、不自然な文・文法が崩れている文・英語として不完全な文だけを抽出して修正してください。",
      "修正不要な文は出力しないでください。",
      "入力には話者ラベル付きの行が含まれます。各修正には必ず話者を紐付けてください。",
      "必ずJSONのみを返してください。Markdownや説明文は不要です。",
      "JSON形式:",
      "{",
      '  "corrections": [',
      "    {",
      '      "index": 1,',
      '      "speaker": "speaker1 | speaker2 | unknown",',
      '      "original": "原文",',
      '      "corrected": "修正文",',
      '      "ja": "自然な日本語訳",',
      '      "reasonJa": "理由を日本語1-2文で簡潔に"',
      "    }",
      "  ]",
      "}",
      "indexは1始まりで連番にしてください。",
      "speakerは speaker1 / speaker2 / unknown のいずれかのみを使ってください。"
    ].join("\n"),
    input: speakerAwareInput,
    responseMimeType: "application/json"
  });

  return normalizeCorrections(response.text);
}

export function normalizeCorrections(raw: string): SpeechFixCorrection[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const corrections = (parsed as { corrections?: unknown })?.corrections;
  if (!Array.isArray(corrections)) {
    return [];
  }

  const out: SpeechFixCorrection[] = [];
  for (let i = 0; i < corrections.length; i += 1) {
    const row = corrections[i] as Record<string, unknown>;
    const original = String(row?.original ?? "").trim();
    const corrected = String(row?.corrected ?? "").trim();
    const ja = String(row?.ja ?? "").trim();
    const reasonJa = String(row?.reasonJa ?? "").trim();
    if (!original || !corrected || !ja || !reasonJa) {
      continue;
    }
    const speaker = normalizeSpeaker(row?.speaker);
    out.push({
      index: Number.isFinite(Number(row?.index)) ? Number(row?.index) : i + 1,
      original,
      corrected,
      ja,
      reasonJa,
      speaker,
      addedFlashcardId: null
    });
  }
  return out;
}

function normalizeSpeaker(raw: unknown): SpeechFixSpeaker {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "speaker1" || value === "1") {
    return 1;
  }
  if (value === "speaker2" || value === "2") {
    return 2;
  }
  return "unknown";
}

function buildSpeakerAwareInput(baseTranscript: string, turns: SpeechDiarizedTurn[]): string {
  if (turns.length === 0) {
    return baseTranscript;
  }
  const lines = turns.map((turn) => `${speakerLabel(turn.speaker)}: ${turn.text}`);
  return lines.join("\n");
}

function speakerLabel(speaker: SpeechDiarizedTurn["speaker"]): string {
  if (speaker === 1) {
    return "Speaker 1";
  }
  if (speaker === 2) {
    return "Speaker 2";
  }
  return "Unknown";
}
