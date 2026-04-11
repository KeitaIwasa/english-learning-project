import { createAdminSupabaseClient, type AdminSupabaseClient } from "@/lib/service";
import { createLineLinkCode } from "@/lib/line";

const LINK_CODE_TTL_MINUTES = 30;
const MAX_CREATE_ATTEMPTS = 5;

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

export type ConsumedLineLinkCodeResult =
  | {
      ok: true;
      userId: string;
      alreadyLinked: boolean;
    }
  | {
      ok: false;
      error: "invalid" | "expired" | "already_used" | "line_user_conflict";
    };

export type LineLinkFailureReason = Extract<ConsumedLineLinkCodeResult, { ok: false }>["error"];

export async function getActiveLineLinkCode(params: {
  adminClient: AppSupabaseClient;
  userId: string;
}) {
  const nowIso = new Date().toISOString();
  const { data, error } = await params.adminClient
    .from("line_link_codes")
    .select("id, code, expires_at, used_at, created_at")
    .eq("user_id", params.userId)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function createOrReuseLineLinkCode(params: {
  adminClient: AppSupabaseClient;
  userId: string;
}) {
  const active = await getActiveLineLinkCode(params);
  if (active?.code && active?.expires_at) {
    await params.adminClient
      .from("profiles")
      .update({ line_link_status: "pending" })
      .eq("user_id", params.userId);
    return {
      code: active.code,
      expiresAt: active.expires_at,
      reused: true
    };
  }

  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const code = createLineLinkCode();
    const inserted = await params.adminClient
      .from("line_link_codes")
      .insert({
        user_id: params.userId,
        code,
        expires_at: expiresAt
      })
      .select("code, expires_at")
      .single();

    if (!inserted.error) {
      await params.adminClient
        .from("profiles")
        .update({ line_link_status: "pending" })
        .eq("user_id", params.userId);
      return {
        code: inserted.data.code,
        expiresAt: inserted.data.expires_at,
        reused: false
      };
    }

    if (inserted.error.code !== "23505") {
      throw inserted.error;
    }
  }

  throw new Error("Failed to create a unique LINE link code");
}

export async function consumeLineLinkCode(params: {
  adminClient: AppSupabaseClient;
  code: string;
  lineUserId: string;
}) {
  const normalizedCode = String(params.code ?? "").trim().toUpperCase();
  const nowIso = new Date().toISOString();

  const { data: codeRow, error } = await params.adminClient
    .from("line_link_codes")
    .select("id, user_id, expires_at, used_at")
    .eq("code", normalizedCode)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!codeRow) {
    return {
      ok: false,
      error: "invalid"
    } satisfies ConsumedLineLinkCodeResult;
  }
  if (codeRow.used_at) {
    return {
      ok: false,
      error: "already_used"
    } satisfies ConsumedLineLinkCodeResult;
  }
  if (codeRow.expires_at <= nowIso) {
    return {
      ok: false,
      error: "expired"
    } satisfies ConsumedLineLinkCodeResult;
  }

  const { data: existingConflict, error: conflictError } = await params.adminClient
    .from("profiles")
    .select("user_id")
    .eq("line_user_id", params.lineUserId)
    .neq("user_id", codeRow.user_id)
    .neq("line_link_status", "unlinked")
    .maybeSingle();

  if (conflictError) {
    throw conflictError;
  }
  if (existingConflict?.user_id) {
    return {
      ok: false,
      error: "line_user_conflict"
    } satisfies ConsumedLineLinkCodeResult;
  }

  const consume = await params.adminClient
    .from("line_link_codes")
    .update({
      used_at: nowIso,
      used_line_user_id: params.lineUserId
    })
    .eq("id", codeRow.id)
    .is("used_at", null)
    .select("user_id")
    .maybeSingle();

  if (consume.error) {
    throw consume.error;
  }
  if (!consume.data?.user_id) {
    return {
      ok: false,
      error: "already_used"
    } satisfies ConsumedLineLinkCodeResult;
  }

  const { data: currentProfile, error: profileError } = await params.adminClient
    .from("profiles")
    .select("line_user_id")
    .eq("user_id", consume.data.user_id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const { error: updateProfileError } = await params.adminClient
    .from("profiles")
    .update({
      line_user_id: params.lineUserId,
      line_push_enabled: true,
      line_link_status: "linked",
      line_linked_at: nowIso
    })
    .eq("user_id", consume.data.user_id);

  if (updateProfileError) {
    throw updateProfileError;
  }

  return {
    ok: true,
    userId: consume.data.user_id,
    alreadyLinked: currentProfile?.line_user_id === params.lineUserId
  } satisfies ConsumedLineLinkCodeResult;
}

export function getLineLinkFailureMessage(error: LineLinkFailureReason) {
  if (error === "expired") {
    return "連携コードの有効期限が切れています。アプリで新しいコードを発行してください。";
  }
  if (error === "already_used") {
    return "この連携コードはすでに使われています。必要なら新しいコードを発行してください。";
  }
  if (error === "line_user_conflict") {
    return "このLINEアカウントは別のユーザーに連携済みです。";
  }
  return "連携コードを確認できませんでした。`link ABCD1234` の形式でもう一度送ってください。";
}

export function buildLineLinkInstructions() {
  return "連携するには、アプリでコードを発行して `link ABCD1234` の形式で送ってください。";
}

export type LineProfileRow = Awaited<ReturnType<typeof getLineProfile>>;

export async function getLineProfile(params: {
  adminClient: AdminSupabaseClient;
  userId: string;
}) {
  const { data, error } = await params.adminClient
    .from("profiles")
    .select("line_push_enabled, line_user_id, line_link_status, line_linked_at, line_last_delivery_at")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}
