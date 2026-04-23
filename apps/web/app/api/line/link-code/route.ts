import { NextResponse } from "next/server";
import { createOrReuseLineLinkCode } from "@/lib/line-link";
import { jsonError, requireRouteUserWithAdmin } from "@/lib/server/route-helpers";

export async function POST() {
  try {
    const auth = await requireRouteUserWithAdmin();
    if (!auth.ok) {
      return auth.response;
    }

    const result = await createOrReuseLineLinkCode({
      adminClient: auth.adminClient,
      userId: auth.user.id
    });

    return NextResponse.json({
      code: result.code,
      expiresAt: result.expiresAt,
      reused: result.reused
    });
  } catch (error) {
    return jsonError(error);
  }
}
