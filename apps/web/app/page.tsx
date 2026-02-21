import Link from "next/link";
import { GoogleLoginButton } from "@/components/google-login-button";
import { AppNav } from "@/components/nav";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function LandingPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  return (
    <main>
      <AppNav />
      <section className="panel">
        <span className="badge">English Learning MVP v2</span>
        <h1>復習連動型 英語学習プラットフォーム</h1>
        <p className="muted">
          直近14日のカード学習状況とチャット要約特徴を使って、毎朝の音読文を自動生成します。
        </p>
        {data.user ? (
          <Link href="/reading">音読ページへ</Link>
        ) : (
          <div>
            <p>Googleアカウントでログインしてください。</p>
            <GoogleLoginButton />
          </div>
        )}
      </section>
    </main>
  );
}
