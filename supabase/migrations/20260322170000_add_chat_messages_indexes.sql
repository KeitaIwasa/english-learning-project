create index if not exists idx_chat_messages_user_created_at_desc
on public.chat_messages(user_id, created_at desc);

create index if not exists idx_chat_messages_thread_created_at_desc
on public.chat_messages(thread_id, created_at desc);
