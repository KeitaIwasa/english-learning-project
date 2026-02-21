export default function AppDashboardPage() {
  return (
    <section className="panel">
      <h2>学習ダッシュボード</h2>
      <p className="muted">Flashcards / Reading / Chat から学習を進めてください。</p>
      <ul>
        <li>毎朝の音読文は復習ターゲット連動で自動生成されます。</li>
        <li>翻訳モードは履歴を使わず高速レスポンス。</li>
        <li>質問モードは履歴と学習シグナルを使って最適化。</li>
      </ul>
    </section>
  );
}
