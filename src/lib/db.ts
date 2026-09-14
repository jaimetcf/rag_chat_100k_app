import { Pool } from "pg";
import { getRequiredEnv } from "@/lib/env";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let pool: Pool | null = null;
let poolPromise: Promise<Pool> | null = null;
let rootDatabaseUrlCache: string | null = null;

/**
 * Serverless + Fluid Compute: a small per-isolate pool so concurrent chats on
 * the same instance do not wait on a single client. Keep this well below Neon
 * pooler capacity (isolates × max). Schema changes belong in pg_migrations/.
 */
const POOL_MAX = readPositiveInt(process.env.PG_POOL_MAX, 8, 20);
const POOL_IDLE_MS = readPositiveInt(process.env.PG_IDLE_TIMEOUT_MS, 5000);
const POOL_CONN_TIMEOUT_MS = readPositiveInt(
  process.env.PG_CONNECTION_TIMEOUT_MS,
  10_000,
);

function readPositiveInt(raw: string | undefined, fallback: number, cap?: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return cap ? Math.min(rounded, cap) : rounded;
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

export function isPoolConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout exceeded when trying to connect|Connection terminated|ECONNRESET|too many clients|remaining connection slots/i.test(
    message,
  );
}

export async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }
  if (!poolPromise) {
    poolPromise = Promise.resolve().then(() => {
      const next = new Pool({
        connectionString: getDatabaseUrl(),
        max: POOL_MAX,
        idleTimeoutMillis: POOL_IDLE_MS,
        connectionTimeoutMillis: POOL_CONN_TIMEOUT_MS,
        allowExitOnIdle: true,
      });
      pool = next;
      return next;
    });
  }
  try {
    return await poolPromise;
  } catch (error) {
    pool = null;
    poolPromise = null;
    throw error;
  }
}
