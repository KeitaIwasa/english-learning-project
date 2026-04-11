import { ReadingGenerateButton } from "@/components/reading-generate-button";
import { ReadingAudioButton } from "@/components/reading-audio-button";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/current-user";

type ReadingPassageRow = {
  id: string;
  title: string;
  body_en: string;
  glossary_ja_json: unknown;
  used_review_targets_json: unknown;
  rationale_json: unknown;
  generated_for_date: string;
  audio_mime_type: string | null;
  audio_voice: string | null;
  created_at: string;
  updated_at?: string | null;
};

export default async function ReadingPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <section className="panel">
        <h2>Reading</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  const supabase = await createSupabaseServerClient();
  const baseSelect =
    "id, title, body_en, glossary_ja_json, used_review_targets_json, rationale_json, generated_for_date, audio_mime_type, audio_voice, created_at";
  let passages: ReadingPassageRow[] = [];

  const primary = await supabase
    .from("reading_passages")
    .select(`${baseSelect}, updated_at`)
    .order("generated_for_date", { ascending: false })
    .limit(1);

  if (primary.error && /updated_at/i.test(primary.error.message)) {
    const fallback = await supabase
      .from("reading_passages")
      .select(baseSelect)
      .order("generated_for_date", { ascending: false })
      .limit(1);
    passages = (fallback.data as ReadingPassageRow[] | null) ?? [];
  } else {
    passages = (primary.data as ReadingPassageRow[] | null) ?? [];
  }

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
            passageId={latest.id}
            audioMimeType={latest.audio_mime_type ?? null}
            audioVoice={latest.audio_voice ?? null}
            audioUpdatedAt={
              typeof latest.updated_at === "string"
                ? latest.updated_at
                : typeof latest.created_at === "string"
                  ? latest.created_at
                  : null
            }
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
