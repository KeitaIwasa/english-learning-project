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
          rationale_json: Json;
          created_at: string;
        };
      };
    };
  };
};
