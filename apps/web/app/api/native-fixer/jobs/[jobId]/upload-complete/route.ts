import { NextResponse } from "next/server";
import { requireAuthUser } from "../../../_utils";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { supabase, user } = await requireAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const { data, error } = await supabase
    .from("speech_fix_jobs")
    .update({
      status: "queued",
      error_message: null
    })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .eq("status", "uploaded")
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or invalid state" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
