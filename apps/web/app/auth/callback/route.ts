import { type NextRequest, NextResponse } from "next/server";
import { ensureProfileExists } from "@/lib/profiles";
import { createAdminSupabaseClient } from "@/lib/service";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user?.id) {
      try {
        await ensureProfileExists({
          userId: user.id,
          adminClient: createAdminSupabaseClient()
        });
      } catch (error) {
        console.error("[auth/callback] failed to ensure profile", error);
      }
    }
  }

  return NextResponse.redirect(new URL("/", requestUrl.origin));
}
