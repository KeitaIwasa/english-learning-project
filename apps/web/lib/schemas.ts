import { z } from "zod";

export const chatRouterRequestSchema = z.object({
  mode: z.enum(["translate", "ask", "add_flashcard"]),
  message: z.string().min(1),
  chatId: z.string().uuid().optional(),
  meta: z
    .object({
      sourceLang: z.enum(["ja", "en"]).optional()
    })
    .optional()
});

export const flashcardReviewRequestSchema = z.object({
  flashcardId: z.string().uuid(),
  remembered: z.boolean()
});

export const flashcardManageUpdateSchema = z.object({
  id: z.string().uuid(),
  en: z.string().trim().min(1),
  ja: z.string().trim()
});

export const flashcardManageDeleteSchema = z.object({
  id: z.string().uuid()
});

export const speechFixJobCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(262_144_000),
  mimeType: z.enum(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/mp4", "audio/m4a"])
});

export const speechFixJobTitleUpdateSchema = z.object({
  customTitle: z.string().trim().max(120)
});

export const speechFixAddFlashcardSchema = z.object({
  confirmed: z.literal(true),
  en: z.string().trim().min(1),
  ja: z.string().trim().optional()
});
