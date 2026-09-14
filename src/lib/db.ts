import { Pool } from "pg";
import { verifyPassword } from "@/lib/auth";
import { getRequiredEnv } from "@/lib/env";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let pool: Pool | null = null;
let rootDatabaseUrlCache: string | null = null;

const PLACEHOLDER_PASSWORD_HASH =
  "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW";

/**
 * Serverless + 100k DAU: use a pooler URL (Neon/Supabase PgBouncer, `?pgbouncer=true`)
 * and keep max connections per lambda low to avoid exhausting Postgres.
 */
const POOL_MAX = Number(process.env.PG_POOL_MAX ?? "1");
const POOL_IDLE_MS = Number(process.env.PG_IDLE_TIMEOUT_MS ?? "5000");
const POOL_CONN_TIMEOUT_MS = Number(
  process.env.PG_CONNECTION_TIMEOUT_MS ?? "3000",
);

async function ensureUsersPasswordHashColumn(p: Pool): Promise<void> {
  const tableExists = await p.query<{
    exists: boolean;
  }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    )`,
  );
  if (!tableExists.rows[0]?.exists) {
    return;
  }

  const columnExists = await p.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'password_hash'`,
  );
  if (columnExists.rowCount) {
    return;
  }

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT",
    );
    await client.query(
      `UPDATE users
       SET password_hash = $1
       WHERE password_hash IS NULL`,
      [PLACEHOLDER_PASSWORD_HASH],
    );
    await client.query(
      "ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const DISPLAY_NAME_SCRUB_COMMENT = "Optional public nickname. password_scrubbed=1";

/**
 * If a password manager filled display_name with the plaintext password,
 * drop those values. Runs once per database (column comment is the marker).
 */
async function scrubPasswordsStoredAsDisplayName(p: Pool): Promise<void> {
  const tableExists = await p.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    )`,
  );
  if (!tableExists.rows[0]?.exists) {
    return;
  }

  const comment = await p.query<{ comment: string | null }>(
    `SELECT col_description(
       'public.users'::regclass,
       (SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.users'::regclass
          AND attname = 'display_name'
          AND NOT attisdropped)
     ) AS comment`,
  );
  if ((comment.rows[0]?.comment ?? "").includes("password_scrubbed=1")) {
    return;
  }

  const rows = await p.query<{ id: string; display_name: string; password_hash: string }>(
    `SELECT id, display_name, password_hash
     FROM users
     WHERE display_name IS NOT NULL AND display_name <> ''`,
  );
  for (const row of rows.rows) {
    if (verifyPassword(row.display_name, row.password_hash)) {
      await p.query(
        `UPDATE users
         SET display_name = NULL
         WHERE id = $1`,
        [row.id],
      );
    }
  }

  await p.query(`COMMENT ON COLUMN users.display_name IS '${DISPLAY_NAME_SCRUB_COMMENT}'`);
}

function readDatabaseUrlFromFile(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  const contents = readFileSync(filePath, "utf8");
  const match = contents.match(/^DATABASE_URL=(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

function getDatabaseUrl(): string {
  const fromProcess = process.env.DATABASE_URL?.trim();
  if (fromProcess) {
    return fromProcess;
  }
  if (rootDatabaseUrlCache !== null) {
    return rootDatabaseUrlCache || getRequiredEnv("DATABASE_URL");
  }

  const envFileNames = [".env.local", ".env"];
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth++) {
    for (const name of envFileNames) {
      const value = readDatabaseUrlFromFile(path.join(dir, name));
      if (value) {
        rootDatabaseUrlCache = value;
        return value;
      }
    }
    const siblingValue = readDatabaseUrlFromFile(
      path.join(dir, "scienta_app", ".env"),
    );
    if (siblingValue) {
      rootDatabaseUrlCache = siblingValue;
      return siblingValue;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  rootDatabaseUrlCache = "";
  return getRequiredEnv("DATABASE_URL");
}

export async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }
  pool = new Pool({
    connectionString: getDatabaseUrl(),
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_MS,
    connectionTimeoutMillis: POOL_CONN_TIMEOUT_MS,
    allowExitOnIdle: true,
  });
  await ensureUsersPasswordHashColumn(pool);
  await scrubPasswordsStoredAsDisplayName(pool);
  return pool;
}
