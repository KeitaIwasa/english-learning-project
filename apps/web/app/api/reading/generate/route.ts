import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!auth.user || !session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.functions.invoke("reading-generate-daily", {
    body: {},
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
