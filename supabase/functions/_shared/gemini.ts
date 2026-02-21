import { appEnv } from "./env.ts";

type GeminiGenerateResult = {
  text: string;
};

function buildGeminiBody(params: {
  instruction: string;
  input: string;
  responseMimeType?: string;
}) {
  return {
    system_instruction: {
      parts: [{ text: params.instruction }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: params.input }]
      }
    ],
    generationConfig: {
      responseMimeType: params.responseMimeType ?? "text/plain"
    }
  };
}

export async function generateWithGemini(params: {
  model: string;
  instruction: string;
  input: string;
  responseMimeType?: string;
}): Promise<GeminiGenerateResult> {
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

export async function* streamWithGemini(params: {
  model: string;
  instruction: string;
  input: string;
  responseMimeType?: string;
}): AsyncGenerator<string> {
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
    const dataLines = eventText
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      return [];
    }

    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      return [];
    }

    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return [];
    }

    // Some Gemini stream payloads may be wrapped in an array.
    const items: unknown[] = Array.isArray(json) ? json : [json];
    const out: string[] = [];

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

    if (out.length > 0) {
      textChunkCount += out.length;
    }

    if (!json || typeof json !== "object") {
      return [];
    }
    return out;
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
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
