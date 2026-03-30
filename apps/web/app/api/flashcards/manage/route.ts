import { NextResponse } from "next/server";
import { z } from "zod";
import { flashcardManageDeleteSchema, flashcardManageUpdateSchema } from "@english/shared";
import { deleteManagedFlashcard, listManagedFlashcards, updateManagedFlashcard } from "@/lib/flashcards-manage-service";
import { jsonError, parseJsonRequest, requireRouteUser } from "@/lib/server/route-helpers";

const flashcardManageListQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

export async function GET(request: Request) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const parsedQuery = flashcardManageListQuerySchema.safeParse({
    q: request.url ? new URL(request.url).searchParams.get("q") ?? undefined : undefined,
    limit: request.url ? new URL(request.url).searchParams.get("limit") ?? undefined : undefined,
    offset: request.url ? new URL(request.url).searchParams.get("offset") ?? undefined : undefined
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 });
  }

  const { q, limit, offset } = parsedQuery.data;
  try {
    return NextResponse.json(
      await listManagedFlashcards({
        supabase: auth.supabase,
        userId: auth.user.id,
        queryText: q?.trim() ?? "",
        limit,
        offset
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const parsed = await parseJsonRequest(request, flashcardManageUpdateSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await updateManagedFlashcard({
      supabase: auth.supabase,
      userId: auth.user.id,
      ...parsed.data
    });
    if (!result) {
      return jsonError("Flashcard not found", 404);
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireRouteUser();
  if (!auth.ok) {
    return auth.response;
  }

  const parsed = await parseJsonRequest(request, flashcardManageDeleteSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await deleteManagedFlashcard({
      supabase: auth.supabase,
      userId: auth.user.id,
      id: parsed.data.id
    });
    if (!result) {
      return jsonError("Flashcard not found", 404);
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
