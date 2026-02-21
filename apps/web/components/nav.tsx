import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { UserMenu } from "@/components/user-menu";

export async function AppNav() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  return (
    <header className="app-header">
      <nav className="app-nav">
        <Link href="/">Home</Link>
        <Link href="/flashcards">Flashcards</Link>
        <Link href="/reading">Reading</Link>
        <Link href="/chat">Chat</Link>
      </nav>
      <div className="app-header-right">{data.user ? <UserMenu email={data.user.email ?? ""} /> : null}</div>
    </header>
  );
}
