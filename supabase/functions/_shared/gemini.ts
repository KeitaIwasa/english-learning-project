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

    if (!json || typeof json !== "object") {
      return [];
    }

    const parsed = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return text ? [text] : [];
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const text of parseEventText(event)) {
        yield text;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const text of parseEventText(buffer)) {
      yield text;
    }
  }
}
