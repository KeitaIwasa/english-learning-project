import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { chatRouterRequestSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!auth.user || !session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = chatRouterRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase.functions.invoke("chat-router", {
    body: parsed.data,
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    const errorLike = error as { message?: string; context?: Response };
    const context = errorLike.context;
    const status = context?.status ?? 500;
    let detail = errorLike.message ?? "Chat function invocation failed";

    if (context) {
      try {
        const raw = await context.text();
        if (raw) {
          detail = `${detail}: ${raw}`;
        }
      } catch {
        // Ignore body parse errors and keep the base message.
      }
    }

    return NextResponse.json({ error: detail }, { status });
  }

  return NextResponse.json(data);
}
