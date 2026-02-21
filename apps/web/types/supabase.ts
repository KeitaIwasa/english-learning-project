export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      flashcards: {
        Row: {
          id: string;
          user_id: string;
          en: string;
          ja: string;
          source: "web" | "extension" | "chat";
          created_at: string;
          updated_at: string;
        };
      };
      flashcard_reviews: {
        Row: {
          id: string;
          flashcard_id: string;
          user_id: string;
          quality: number;
          interval_days: number;
          ease_factor: number;
          repetition: number;
          reviewed_at: string;
          next_review_at: string;
        };
      };
      reading_passages: {
        Row: {
          id: string;
          user_id: string;
          profile_id: string | null;
          title: string;
          body_en: string;
          glossary_ja_json: Json;
          difficulty: string | null;
          generated_for_date: string;
          used_review_targets_json: Json;
          used_new_targets_json: Json;
          audio_base64: string | null;
          audio_mime_type: string | null;
          audio_voice: string | null;
          rationale_json: Json;
          created_at: string;
        };
      };
      speech_fix_jobs: {
        Row: {
          id: string;
          user_id: string;
          file_name: string;
          custom_title: string | null;
          file_size: number;
          mime_type: string;
          status: "uploaded" | "queued" | "processing" | "completed" | "failed";
          storage_path: string | null;
          transcript_full: string | null;
          corrections_json: Json;
          stats_json: Json;
          error_message: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
      };
    };
  };
};
