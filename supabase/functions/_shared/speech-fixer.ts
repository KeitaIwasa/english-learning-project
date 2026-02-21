import { generateWithGemini } from "./gemini.ts";
import { appEnv } from "./env.ts";

export type SpeechFixCorrection = {
  index: number;
  original: string;
  corrected: string;
  ja: string;
  reasonJa: string;
  addedFlashcardId: string | null;
};

export async function buildSpeechFixCorrections(transcript: string): Promise<SpeechFixCorrection[]> {
  const text = transcript.trim();
  if (!text) {
    return [];
  }

  const response = await generateWithGemini({
    model: appEnv.geminiFastModel(),
    instruction: [
      "あなたは英語添削の専門家です。",
      "入力された英語の文字起こし文から、不自然な文・文法が崩れている文・英語として不完全な文だけを抽出して修正してください。",
      "修正不要な文は出力しないでください。",
      "必ずJSONのみを返してください。Markdownや説明文は不要です。",
      "JSON形式:",
      "{",
      '  "corrections": [',
      "    {",
      '      "index": 1,',
      '      "original": "原文",',
      '      "corrected": "修正文",',
      '      "ja": "自然な日本語訳",',
      '      "reasonJa": "理由を日本語1-2文で簡潔に"',
      "    }",
      "  ]",
      "}",
      "indexは1始まりで連番にしてください。"
    ].join("\n"),
    input: text,
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
    out.push({
      index: Number.isFinite(Number(row?.index)) ? Number(row?.index) : i + 1,
      original,
      corrected,
      ja,
      reasonJa,
      addedFlashcardId: null
    });
  }
  return out;
}
