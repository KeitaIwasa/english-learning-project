import { appEnv } from "@/lib/app-env";

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
        continue;
      }

      const items: unknown[] = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const record = item as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          error?: { message?: string };
        };
        if (record?.error?.message) {
          throw new Error(`Gemini stream payload error: ${record.error.message}`);
        }
        const text = record?.candidates?.[0]?.content?.parts?.map((part) => String(part?.text ?? "")).join("") ?? "";
        if (text) {
          out.push(text);
        }
      }
    }
    return out;
  };

  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventText of events) {
      const texts = parseEventText(eventText);
      for (const text of texts) {
        if (text) {
          yield text;
        }
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const texts = parseEventText(buffer);
    for (const text of texts) {
      if (text) {
        yield text;
      }
    }
  }
}

export async function synthesizeSpeechWithGemini(params: {
  text: string;
  model: string;
  speakerVoiceConfigs: Array<{
    speaker: string;
    voice: string;
  }>;
}): Promise<GeminiTtsResult> {
  const input = String(params.text ?? "").trim();
  if (!input) {
    throw new Error("Gemini TTS input text is empty");
  }

  const speakerVoiceConfigs = (params.speakerVoiceConfigs ?? [])
    .map((item) => ({
      speaker: String(item?.speaker ?? "").trim(),
      voice: String(item?.voice ?? "").trim()
    }))
    .filter((item) => item.speaker.length > 0 && item.voice.length > 0);

  if (speakerVoiceConfigs.length === 0) {
    throw new Error("Gemini TTS speakerVoiceConfigs is empty");
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
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakerVoiceConfigs.map((item) => ({
              speaker: item.speaker,
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: item.voice
                }
              }
            }))
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

  const audioBase64 = audioParts.map((part) => String(part.data ?? "")).join("");
  if (!audioBase64) {
    throw new Error("Gemini TTS response audio data is empty");
  }

  return { audioBase64, mimeType };
}
