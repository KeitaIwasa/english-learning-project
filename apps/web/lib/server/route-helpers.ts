import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { ZodTypeAny } from "zod";
import { createAdminSupabaseClient } from "@/lib/service";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export function jsonError(error: unknown, status = 500) {
  const message = typeof error === "string" ? error : String(error);
  return NextResponse.json({ error: message }, { status });
}

export function jsonValidationError(error: unknown) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function parseJsonRequest<TSchema extends ZodTypeAny>(request: Request, schema: TSchema) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return {
      ok: false as const,
      response: jsonValidationError(parsed.error.flatten())
    };
  }

  return {
    ok: true as const,
    data: parsed.data
  };
}

export async function requireRouteUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: jsonError("Unauthorized", 401)
    };
  }

  return {
    ok: true as const,
    supabase,
    user
  };
}

export async function requireRouteUserWithAdmin() {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth;
  }

  return {
    ok: true as const,
    supabase: auth.supabase,
    user: auth.user,
    adminClient: createAdminSupabaseClient()
  };
}

export type AuthenticatedRouteUser = User;
