import { assertEquals } from "jsr:@std/assert";
import { extractTranscriptFromSpeechBatchResponse } from "./google-cloud.ts";

Deno.test("話者ラベル付き単語列からターンを抽出できる", () => {
  const result = extractTranscriptFromSpeechBatchResponse({
    response: {
      results: {
        "gs://bucket/file.wav": {
          inlineResult: {
            transcript: {
              results: [
                {
                  alternatives: [
                    {
                      transcript: "Hello there. How are you?",
                      words: [
                        { word: "Hello", speakerLabel: "1" },
                        { word: "there.", speakerLabel: "1" },
                        { word: "How", speakerLabel: "2" },
                        { word: "are", speakerLabel: "2" },
                        { word: "you?", speakerLabel: "2" }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    },
    gcsUri: "gs://bucket/file.wav"
  });

  assertEquals(result.transcript, "Hello there. How are you?");
  assertEquals(result.turns, [
    { speaker: 1, text: "Hello there." },
    { speaker: 2, text: "How are you?" }
  ]);
});

Deno.test("話者ラベル欠落や3人目はunknownに寄せる", () => {
  const result = extractTranscriptFromSpeechBatchResponse({
    response: {
      results: {
        "gs://bucket/file.wav": {
          inlineResult: {
            transcript: {
              results: [
                {
                  alternatives: [
                    {
                      transcript: "Hi. Nice to meet you.",
                      words: [
                        { word: "Hi.", speakerLabel: "3" },
                        { word: "Nice", speakerLabel: "3" },
                        { word: "to", speakerLabel: "3" },
                        { word: "meet" },
                        { word: "you." }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    },
    gcsUri: "gs://bucket/file.wav"
  });

  assertEquals(result.turns, [{ speaker: "unknown", text: "Hi. Nice to meet you." }]);
  assertEquals(result.detectedSpeakerCount, 1);
});
