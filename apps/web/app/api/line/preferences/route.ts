import { NextResponse } from "next/server";
import { lineDeliveryToggleSchema } from "@/lib/shared";
import { jsonError, parseJsonRequest, requireRouteUserWithAdmin } from "@/lib/server/route-helpers";

export async function PATCH(request: Request) {
  try {
    const auth = await requireRouteUserWithAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseJsonRequest(request, lineDeliveryToggleSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const updated = await auth.adminClient
      .from("profiles")
      .update({ line_push_enabled: parsed.data.enabled })
      .eq("user_id", auth.user.id)
      .select("line_push_enabled")
      .single();

    if (updated.error) {
      throw updated.error;
    }

    return NextResponse.json({
      ok: true,
      enabled: updated.data.line_push_enabled
    });
  } catch (error) {
    return jsonError(error);
  }
}
