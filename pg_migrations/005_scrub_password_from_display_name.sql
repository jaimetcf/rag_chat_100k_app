-- display_name is a public nickname. Never keep a value that is the user's
-- plaintext password (password managers often autofill the field after
-- the password input).
--
-- Best-effort SQL using pgcrypto. The app also scrubs with bcryptjs on
-- first pool init so hashes that crypt() cannot verify are still cleared.
UPDATE users
SET display_name = NULL
WHERE display_name IS NOT NULL
  AND display_name <> ''
  AND password_hash = crypt(display_name, password_hash);
