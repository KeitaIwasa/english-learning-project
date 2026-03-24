import { assertEquals } from "jsr:@std/assert";
import { normalizeCorrections } from "./speech-fixer.ts";

Deno.test("speakerの正規化: speaker1/speaker2/unknown", () => {
  const result = normalizeCorrections(
    JSON.stringify({
      corrections: [
        {
          index: 1,
          speaker: "speaker1",
          original: "I no went.",
          corrected: "I didn't go.",
          ja: "私は行きませんでした。",
          reasonJa: "否定の過去形を使う必要があります。"
        },
        {
          index: 2,
          speaker: "speaker2",
          original: "She don't likes it.",
          corrected: "She doesn't like it.",
          ja: "彼女はそれが好きではありません。",
          reasonJa: "三人称単数の現在形に合わせます。"
        },
        {
          index: 3,
          speaker: "something-else",
          original: "Good weather isn't it?",
          corrected: "The weather is good, isn't it?",
          ja: "天気がいいですね。",
          reasonJa: "主語とbe動詞を補う必要があります。"
        }
      ]
    })
  );

  assertEquals(result.map((item) => item.speaker), [1, 2, "unknown"]);
});

Deno.test("speaker欠落時はunknown", () => {
  const result = normalizeCorrections(
    JSON.stringify({
      corrections: [
        {
          index: 1,
          original: "I can to swim.",
          corrected: "I can swim.",
          ja: "私は泳げます。",
          reasonJa: "助動詞の後は動詞の原形です。"
        }
      ]
    })
  );

  assertEquals(result[0]?.speaker, "unknown");
});
