import { ReadingGenerateButton } from "@/components/reading-generate-button";
import { ReadingAudioButton } from "@/components/reading-audio-button";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function ReadingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <section className="panel">
        <h2>Reading</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  const { data: passages } = await supabase
    .from("reading_passages")
    .select(
      "id, title, body_en, glossary_ja_json, used_review_targets_json, rationale_json, generated_for_date, audio_base64, audio_mime_type, audio_voice"
    )
    .order("generated_for_date", { ascending: false })
    .limit(7);

  const latest = passages?.[0];
  const reviewTargets = (latest?.used_review_targets_json as string[] | null) ?? [];
  const rationale =
    (latest?.rationale_json as
      | {
          reason?: string;
          askCount?: number;
          translatePairCount?: number;
          flashcardPairCount?: number;
          trimmedCount?: number;
          contextChars?: number;
        }
      | null) ?? {};

  return (
    <div className="grid">
      <section className="panel">
        <h2>音読トレーニング</h2>
        <p className="muted">毎朝06:00 JSTに、直近5日以内の会話履歴と未習熟フラッシュカードから自動生成されます。</p>
        <ReadingGenerateButton />
      </section>

      {latest ? (
        <section className="panel">
          <span className="badge">{latest.generated_for_date}</span>
          <h3>{latest.title}</h3>
          <ReadingAudioButton
            audioBase64={latest.audio_base64 ?? null}
            audioMimeType={latest.audio_mime_type ?? null}
            audioVoice={latest.audio_voice ?? null}
          />
          <p style={{ whiteSpace: "pre-wrap", lineHeight: "1.7" }}>{latest.body_en}</p>
          <h4>今日の復習ポイント</h4>
          <ul>
            {reviewTargets.map((target) => (
              <li key={target}>{target}</li>
            ))}
          </ul>
          <p className="muted">選定理由: {rationale.reason ?? "会話履歴とフラッシュカードを反映"}</p>
          {typeof rationale.askCount === "number" ||
          typeof rationale.translatePairCount === "number" ||
          typeof rationale.flashcardPairCount === "number" ? (
            <p className="muted">
              反映コンテキスト: ask {rationale.askCount ?? 0}件 / 翻訳 {rationale.translatePairCount ?? 0}ペア /
              フラッシュカード {rationale.flashcardPairCount ?? 0}ペア
            </p>
          ) : null}
          {typeof rationale.trimmedCount === "number" || typeof rationale.contextChars === "number" ? (
            <p className="muted">
              トリム: {rationale.trimmedCount ?? 0}件, 入力文字数: {rationale.contextChars ?? 0}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="panel">
          <p>まだ音読文がありません。手動生成してください。</p>
        </section>
      )}
    </div>
  );
}
