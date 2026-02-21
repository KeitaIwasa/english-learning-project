import { appEnv } from "./env.ts";

type GeminiGenerateResult = {
  text: string;
};

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
    body: JSON.stringify({
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
    })
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
