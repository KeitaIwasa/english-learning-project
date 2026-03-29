import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  buildGcsV4SignedPutUrl,
  checkGcsObjectExists,
  extractTranscriptFromSpeechBatchResponse,
  extractTranscriptFromSpeechLongRunningResponse,
  parseGoogleServiceAccount
} from "./google-cloud";

function createServiceAccountFixture() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return parseGoogleServiceAccount(
    JSON.stringify({
      client_email: "native-fixer@test.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    })
  );
}

describe("buildGcsV4SignedPutUrl", () => {
  it("creates a signed URL with required query and path", () => {
    const url = buildGcsV4SignedPutUrl({
      serviceAccount: createServiceAccountFixture(),
      bucket: "test-bucket",
      objectName: "speech-fixer/u1/j1/audio file.mp3",
      contentType: "audio/mpeg",
      expiresSeconds: 900,
      now: new Date("2026-02-28T01:00:00.000Z")
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://storage.googleapis.com");
    expect(parsed.pathname).toBe("/test-bucket/speech-fixer/u1/j1/audio%20file.mp3");
    expect(parsed.searchParams.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
    expect(parsed.searchParams.get("X-Goog-Expires")).toBe("900");
    expect(parsed.searchParams.get("X-Goog-SignedHeaders")).toBe("content-type;host");
    expect(parsed.searchParams.get("X-Goog-Signature")).toMatch(/^[a-f0-9]+$/);
  });
});

describe("checkGcsObjectExists", () => {
  it("returns exists=false for 404", async () => {
    const mocked = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", mocked);
    await expect(
      checkGcsObjectExists({
        accessToken: "token",
        bucket: "bucket",
        objectName: "obj"
      })
    ).resolves.toEqual({ exists: false });
    vi.unstubAllGlobals();
  });
});

describe("extractTranscriptFromSpeechBatchResponse", () => {
  it("returns file-level errors from batch response", () => {
    const extracted = extractTranscriptFromSpeechBatchResponse({
      response: {
        results: {
          "gs://bucket/audio.mp3": {
            error: {
              code: 3,
              message: "File is too long. Only audio files up to 60 minutes long are supported for BatchRecognize."
            },
            transcript: { results: [] },
            inlineResult: { transcript: { results: [] } }
          }
        }
      },
      gcsUri: "gs://bucket/audio.mp3"
    });
    expect(extracted.transcript).toBe("");
    expect(extracted.fileErrors).toEqual([
      "File is too long. Only audio files up to 60 minutes long are supported for BatchRecognize."
    ]);
  });
});

describe("extractTranscriptFromSpeechLongRunningResponse", () => {
  it("extracts transcript and diarized turns from v1 response", () => {
    const extracted = extractTranscriptFromSpeechLongRunningResponse({
      response: {
        results: [
          {
            alternatives: [
              {
                transcript: "hello there",
                words: [
                  { word: "hello", speakerTag: 1 },
                  { word: "there", speakerTag: 1 }
                ]
              }
            ]
          },
          {
            alternatives: [
              {
                transcript: "how are you",
                words: [
                  { word: "how", speakerTag: 2 },
                  { word: "are", speakerTag: 2 },
                  { word: "you", speakerTag: 2 }
                ]
              }
            ]
          }
        ]
      }
    });
    expect(extracted.transcript).toBe("hello there\nhow are you");
    expect(extracted.turns).toEqual([
      { speaker: 1, text: "hello there" },
      { speaker: 2, text: "how are you" }
    ]);
    expect(extracted.detectedSpeakerCount).toBe(2);
  });
});
