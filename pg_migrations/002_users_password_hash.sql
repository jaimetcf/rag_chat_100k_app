-- Add password storage for email/password auth (additive migration for existing DBs).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Valid bcrypt encoding so verify does not throw; unknown password until user resets.
UPDATE users
SET password_hash = '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW'
WHERE password_hash IS NULL;

ALTER TABLE users
    ALTER COLUMN password_hash SET NOT NULL;
