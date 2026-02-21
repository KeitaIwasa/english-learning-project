"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type GoogleLoginButtonProps = {
  compact?: boolean;
};

export function GoogleLoginButton({ compact = false }: GoogleLoginButtonProps) {
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

  if (compact) {
    return (
      <button type="button" onClick={signIn} className="user-avatar-btn user-login-btn" aria-label="Googleでログイン">
        <span className="user-avatar user-avatar-login" aria-hidden="true">
          G
        </span>
        <span className="sr-only">Googleでログイン</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={signIn}>
      Googleでログイン
    </button>
  );
}
