"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function GoogleLoginButton() {
  const signIn = async () => {
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`
      }
    });
  };

  return <button onClick={signIn}>Googleでログイン</button>;
}
