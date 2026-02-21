import { appEnv } from "./env.ts";

type GeminiGenerateResult = {
  text: string;
};

type GeminiTtsResult = {
  audioBase64: string;
  mimeType: string;
};

export type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type GeminiRequest = {
  model: string;
  instruction: string;
  input?: string;
  contents?: GeminiContent[];
  responseMimeType?: string;
};

function buildGeminiBody(params: {
  instruction: string;
  input?: string;
  contents?: GeminiContent[];
  responseMimeType?: string;
}) {
  const normalizedContents = (params.contents ?? [])
    .map((content) => ({
      role: content.role,
      parts: (content.parts ?? [])
        .map((part) => ({ text: String(part?.text ?? "") }))
        .filter((part) => part.text.trim().length > 0)
    }))
    .filter((content) => content.parts.length > 0);

  if (normalizedContents.length === 0) {
    const input = String(params.input ?? "");
    if (!input.trim()) {
      throw new Error("Gemini request requires either non-empty contents or input");
    }

    normalizedContents.push({
      role: "user",
      parts: [{ text: input }]
    });
  }

  return {
    system_instruction: {
      parts: [{ text: params.instruction }]
    },
    contents: normalizedContents,
    generationConfig: {
      responseMimeType: params.responseMimeType ?? "text/plain"
    }
  };
}

export async function generateWithGemini(params: GeminiRequest): Promise<GeminiGenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${appEnv.geminiApiKey()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildGeminiBody(params))
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${body}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini response missing text");
  }

  return { text };
}

export async function synthesizeSpeechWithGemini(params: {
  text: string;
  model: string;
  voice: string;
}): Promise<GeminiTtsResult> {
  const input = String(params.text ?? "").trim();
  if (!input) {
    throw new Error("Gemini TTS input text is empty");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${appEnv.geminiApiKey()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: input }]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: params.voice
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini TTS API error: ${response.status} ${body}`);
  }

  const json = await response.json();
  const parts = (json?.candidates?.[0]?.content?.parts ?? []) as Array<{
    inlineData?: { mimeType?: string; data?: string };
  }>;
  const audioParts = parts
    .map((part) => part.inlineData)
    .filter((item): item is { mimeType?: string; data?: string } => Boolean(item?.data));

  if (audioParts.length === 0) {
    throw new Error("Gemini TTS response missing audio inlineData");
  }

  const mimeType = audioParts[0]?.mimeType;
  if (!mimeType) {
    throw new Error("Gemini TTS response missing mimeType");
  }

  const mixedMimeType = audioParts.some((part) => part.mimeType && part.mimeType !== mimeType);
  if (mixedMimeType) {
    throw new Error("Gemini TTS response has inconsistent audio mimeType");
  }

  const audioBase64 = concatBase64Chunks(audioParts.map((part) => String(part.data ?? "")));
  if (!audioBase64) {
    throw new Error("Gemini TTS response audio data is empty");
  }

  const pcmSampleRate = parsePcm16SampleRate(mimeType);
  if (!pcmSampleRate) {
    return { audioBase64, mimeType };
  }

  const pcmBytes = base64ToBytes(audioBase64);
  const wavBytes = pcm16MonoToWavBytes(pcmBytes, pcmSampleRate);
  return { audioBase64: bytesToBase64(wavBytes), mimeType: "audio/wav" };
}

export async function* streamWithGemini(params: GeminiRequest): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent?alt=sse&key=${appEnv.geminiApiKey()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildGeminiBody(params))
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${body}`);
  }

  if (!response.body) {
    throw new Error("Gemini stream response missing body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let textChunkCount = 0;
  let lastDebugSummary = "";

  const summarizePayload = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") {
      return "non_object_payload";
    }

    const record = payload as {
      error?: { message?: string };
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const first = record.candidates?.[0];
    const partCount = first?.content?.parts?.length ?? 0;
    const textParts = (first?.content?.parts ?? []).filter((part) => Boolean(part?.text)).length;
    const thoughtParts = (first?.content?.parts ?? []).filter((part) => Boolean(part?.thought)).length;
    return JSON.stringify({
      hasError: Boolean(record.error),
      errorMessage: record.error?.message ?? null,
      blockReason: record.promptFeedback?.blockReason ?? null,
      finishReason: first?.finishReason ?? null,
      partCount,
      textParts,
      thoughtParts
    });
  };

  const parseEventText = (eventText: string): string[] => {
    const normalized = eventText.replace(/\r/g, "");
    const rawLines = normalized
      .split("\n")
      .map((line) => line.trimStart());
    const dataLines = rawLines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());

    const payloadCandidates = dataLines.length > 0 ? [dataLines.join("\n")] : [normalized.trim()];

    const out: string[] = [];
    for (const payload of payloadCandidates) {
      if (!payload || payload === "[DONE]") {
        continue;
      }

      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        lastDebugSummary = `json_parse_failed:${payload.slice(0, 200)}`;
        continue;
      }

      // Some Gemini stream payloads may be wrapped in an array.
      const items: unknown[] = Array.isArray(json) ? json : [json];

      for (const item of items) {
        lastDebugSummary = summarizePayload(item);
        if (!item || typeof item !== "object") {
          continue;
        }

        const parsed = item as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (text) {
          out.push(text);
        }
      }
    }

    if (out.length > 0) {
      textChunkCount += out.length;
    }
    return out;
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const event of events) {
      eventCount += 1;
      for (const text of parseEventText(event)) {
        yield text;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    eventCount += 1;
    for (const text of parseEventText(buffer)) {
      yield text;
    }
  }

  if (textChunkCount === 0) {
    throw new Error(
      `Gemini stream returned no text (model=${params.model}, events=${eventCount}, last=${lastDebugSummary || "n/a"})`
    );
  }
}

function concatBase64Chunks(chunks: string[]): string {
  if (chunks.length === 1) {
    return chunks[0];
  }

  const decoded = chunks.map((chunk) => Uint8Array.from(atob(chunk), (char) => char.charCodeAt(0)));
  const totalLength = decoded.reduce((sum, bytes) => sum + bytes.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of decoded) {
    merged.set(bytes, offset);
    offset += bytes.length;
  }

  let binary = "";
  for (const value of merged) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function parsePcm16SampleRate(mimeType: string): number | null {
  if (!/^audio\/l16/i.test(mimeType)) {
    return null;
  }
  const match = mimeType.match(/rate=(\d+)/i);
  const sampleRate = Number(match?.[1] ?? 24000);
  return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function pcm16MonoToWavBytes(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.length;
  const wavSize = 44 + dataSize;

  const wav = new Uint8Array(wavSize);
  const view = new DataView(wav.buffer);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, dataSize, true);
  wav.set(pcmBytes, 44);

  return wav;
}

function writeAscii(target: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    target[offset + i] = text.charCodeAt(i);
  }
}
