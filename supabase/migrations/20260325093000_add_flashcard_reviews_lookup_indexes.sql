create index if not exists idx_flashcard_reviews_user_card_reviewed_at
  on public.flashcard_reviews(user_id, flashcard_id, reviewed_at desc);

create index if not exists idx_flashcard_reviews_user_next_review_at
  on public.flashcard_reviews(user_id, next_review_at asc);
