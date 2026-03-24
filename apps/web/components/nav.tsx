import { UserMenu } from "@/components/user-menu";
import { NavLinks } from "@/components/nav-links";
import { GoogleLoginButton } from "@/components/google-login-button";
import { getCurrentUser } from "@/lib/current-user";

export async function AppNav() {
  const user = await getCurrentUser();

  return (
    <header className="app-header">
      <nav className="app-nav">
        <NavLinks />
      </nav>
      <div className="app-header-right">
        {user ? <UserMenu email={user.email ?? ""} /> : <GoogleLoginButton compact />}
      </div>
    </header>
  );
}
