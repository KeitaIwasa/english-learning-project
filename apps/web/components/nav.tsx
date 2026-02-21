import { createSupabaseServerClient } from "@/lib/supabase-server";
import { UserMenu } from "@/components/user-menu";
import { NavLinks } from "@/components/nav-links";
import { GoogleLoginButton } from "@/components/google-login-button";

export async function AppNav() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  return (
    <header className="app-header">
      <nav className="app-nav">
        <NavLinks />
      </nav>
      <div className="app-header-right">
        {data.user ? <UserMenu email={data.user.email ?? ""} /> : <GoogleLoginButton compact />}
      </div>
    </header>
  );
}
