import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function FlashcardsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <section className="panel">
        <h2>Flashcards</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  const { data: cards } = await supabase
    .from("flashcards")
    .select("id, en, ja, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="grid">
      <section className="panel">
        <h2>フラッシュカード追加</h2>
        <form action="/api/flashcards" method="post" className="grid">
          <label>
            English
            <textarea name="en" required rows={3} />
          </label>
          <label>
            日本語訳（任意）
            <textarea name="ja" rows={2} />
          </label>
          <button type="submit">追加</button>
        </form>
      </section>

      <section className="panel">
        <h2>最近のカード</h2>
        <ul>
          {(cards ?? []).map((card) => (
            <li key={card.id}>
              <p>{card.en}</p>
              <p className="muted">{card.ja}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
