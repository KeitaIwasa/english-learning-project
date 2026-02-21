import { z } from "zod";

export const chatModeSchema = z.enum(["translate", "ask", "add_flashcard"]);

export const chatRouterRequestSchema = z.object({
  mode: chatModeSchema,
  message: z.string().min(1),
  chatId: z.string().uuid().optional(),
  meta: z
    .object({
      sourceLang: z.enum(["ja", "en"]).optional()
    })
    .optional()
});

export const flashcardAddRequestSchema = z.object({
  en: z.string().min(1),
  ja: z.string().optional(),
  source: z.enum(["web", "extension", "chat"])
});

export const learningProfileBuildRequestSchema = z.object({
  userId: z.string().uuid().optional(),
  lookbackDays: z.number().int().min(1).max(60).default(14)
});

export const learningProfileSchema = z.object({
  reviewTargets: z.array(z.string()).default([]),
  grammarTargets: z.array(z.string()).default([]),
  newCandidates: z.array(z.string()).default([])
});

export const readingGenerateRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  profileId: z.string().uuid().optional()
});

export const generatedPassageSchema = z.object({
  passage: z.string().min(1),
  title: z.string().min(1),
  glossary: z.array(
    z.object({
      en: z.string().min(1),
      ja: z.string().min(1)
    })
  ),
  review_points: z.array(
    z.object({
      target: z.string().min(1),
      explanationJa: z.string().min(1),
      excerpt: z.string().min(1)
    })
  ),
  used_targets: z.object({
    review: z.array(z.string()),
    new: z.array(z.string())
  })
});

export type ChatMode = z.infer<typeof chatModeSchema>;
export type ChatRouterRequest = z.infer<typeof chatRouterRequestSchema>;
export type FlashcardAddRequest = z.infer<typeof flashcardAddRequestSchema>;
export type LearningProfileBuildRequest = z.infer<typeof learningProfileBuildRequestSchema>;
export type ReadingGenerateRequest = z.infer<typeof readingGenerateRequestSchema>;
export type GeneratedPassage = z.infer<typeof generatedPassageSchema>;
