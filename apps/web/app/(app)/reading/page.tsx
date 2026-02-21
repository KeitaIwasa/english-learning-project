import { ReadingGenerateButton } from "@/components/reading-generate-button";
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
    .select("id, title, body_en, glossary_ja_json, used_review_targets_json, rationale_json, generated_for_date")
    .order("generated_for_date", { ascending: false })
    .limit(7);

  const latest = passages?.[0];
  const reviewTargets = (latest?.used_review_targets_json as string[] | null) ?? [];
  const rationale = (latest?.rationale_json as { grammarTargets?: string[]; reason?: string } | null) ?? {};

  return (
    <div className="grid">
      <section className="panel">
        <h2>音読トレーニング</h2>
        <p className="muted">毎朝06:00 JSTに、直近14日の学習内容から復習最適化して自動生成されます。</p>
        <ReadingGenerateButton />
      </section>

      {latest ? (
        <section className="panel">
          <span className="badge">{latest.generated_for_date}</span>
          <h3>{latest.title}</h3>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: "1.7" }}>{latest.body_en}</p>
          <h4>今日の復習ポイント</h4>
          <ul>
            {reviewTargets.map((target) => (
              <li key={target}>{target}</li>
            ))}
          </ul>
          <p className="muted">選定理由: {rationale.reason ?? "カード期限・誤答傾向・チャット特徴を反映"}</p>
          {Array.isArray(rationale.grammarTargets) && rationale.grammarTargets.length > 0 ? (
            <p className="muted">文法ターゲット: {rationale.grammarTargets.join(", ")}</p>
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
