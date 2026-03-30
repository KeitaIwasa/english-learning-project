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
  date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  profileId: z.string().uuid().optional(),
  force: z.boolean().optional()
});

export const speechFixJobStatusSchema = z.enum(["uploaded", "queued", "processing", "completed", "failed"]);

export const speechFixCorrectionSchema = z.object({
  index: z.number().int().positive(),
  original: z.string().min(1),
  corrected: z.string().min(1),
  ja: z.string().min(1),
  reasonJa: z.string().min(1),
  addedFlashcardId: z.string().uuid().nullable()
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
export type FlashcardReviewRequest = z.infer<typeof flashcardReviewRequestSchema>;
export type FlashcardManageUpdateRequest = z.infer<typeof flashcardManageUpdateSchema>;
export type FlashcardManageDeleteRequest = z.infer<typeof flashcardManageDeleteSchema>;
export type LearningProfileBuildRequest = z.infer<typeof learningProfileBuildRequestSchema>;
export type ReadingGenerateRequest = z.infer<typeof readingGenerateRequestSchema>;
export type GeneratedPassage = z.infer<typeof generatedPassageSchema>;
export type SpeechFixJobStatus = z.infer<typeof speechFixJobStatusSchema>;
export type SpeechFixCorrection = z.infer<typeof speechFixCorrectionSchema>;
export type SpeechFixJobCreateRequest = z.infer<typeof speechFixJobCreateSchema>;
export type SpeechFixJobTitleUpdateRequest = z.infer<typeof speechFixJobTitleUpdateSchema>;
export type SpeechFixAddFlashcardRequest = z.infer<typeof speechFixAddFlashcardSchema>;
