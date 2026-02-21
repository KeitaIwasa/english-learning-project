import { NativeFixerClient } from "@/components/native-fixer-client";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { unstable_noStore as noStore } from "next/cache";

export default async function NativeFixerPage() {
  noStore();
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <section className="panel">
        <h2>Native English Fixer</h2>
        <p>ログイン後に利用できます。</p>
      </section>
    );
  }

  return <NativeFixerClient />;
}
