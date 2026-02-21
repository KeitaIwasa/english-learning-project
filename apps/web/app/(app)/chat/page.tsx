import { ChatClient } from "@/components/chat-client";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <section className="panel">
        <h2>Chat</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  return (
    <section className="chat-page">
      <ChatClient />
    </section>
  );
}
