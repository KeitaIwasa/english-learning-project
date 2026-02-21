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
