import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  buildGcsV4SignedGetUrl,
  buildGcsV4SignedPutUrl,
  checkGcsObjectExists,
  extractTranscriptFromSpeechBatchResponse,
  parseGoogleServiceAccount,
  startSpeechBatchRecognize
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

describe("buildGcsV4SignedGetUrl", () => {
  it("creates a signed GET URL with host-only signed headers", () => {
    const url = buildGcsV4SignedGetUrl({
      serviceAccount: createServiceAccountFixture(),
      bucket: "test-bucket",
      objectName: "line-audio/u1/job-1/reading.mp3",
      expiresSeconds: 3600,
      now: new Date("2026-04-11T00:00:00.000Z")
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://storage.googleapis.com");
    expect(parsed.pathname).toBe("/test-bucket/line-audio/u1/job-1/reading.mp3");
    expect(parsed.searchParams.get("X-Goog-Expires")).toBe("3600");
    expect(parsed.searchParams.get("X-Goog-SignedHeaders")).toBe("host");
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

describe("startSpeechBatchRecognize", () => {
  it("sends a v2 request without diarization config", async () => {
    const mocked = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "operations/123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", mocked);

    await expect(
      startSpeechBatchRecognize({
        accessToken: "token",
        projectId: "project-id",
        location: "us",
        languageCode: "en-US",
        model: "chirp_3",
        gcsUri: "gs://bucket/audio.mp3"
      })
    ).resolves.toBe("operations/123");

    const request = mocked.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body ?? "{}")) as {
      config?: { features?: Record<string, unknown> };
    };
    expect(body.config?.features).toEqual({
      enableAutomaticPunctuation: true
    });
    vi.unstubAllGlobals();
  });
});
