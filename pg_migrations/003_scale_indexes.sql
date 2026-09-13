-- Additional indexes for ~100k DAU read patterns (safe to run on existing DBs).

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated_active
    ON chat_sessions (user_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
    ON chat_messages (session_id, created_at DESC);
