import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  formatMessageTimePtBr,
  formatSessionSidebarDate,
} from "@/lib/formatting";
export type SessionDto = {
  id: string;
  title: string;
  title_short: string;
  updated_at: string;
  created_at: string;
  updated_display: string;
};

export type ThreadMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  time_display: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type DbSession = {
  id: string;
  title: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type DbMessage = {
  id: string;
  role: string;
  content: string;
  model: string | null;
  sequence_no: number;
  created_at: Date | string;
  token_usage_json: unknown;
};

function mapSessionRow(row: DbSession): SessionDto {
  const title = row.title || "New Chat";
  const titleShort = title.length <= 30 ? title : `${title.slice(0, 27)}...`;
  const updatedIso = new Date(row.updated_at).toISOString();
  const createdIso = new Date(row.created_at).toISOString();
  return {
    id: row.id,
    title,
    title_short: titleShort,
    updated_at: updatedIso,
    created_at: createdIso,
    updated_display: formatSessionSidebarDate(updatedIso),
  };
}

function mapThreadMessageRow(row: DbMessage): ThreadMessageDto {
  const createdAt = new Date(row.created_at).toISOString();
  return {
    id: row.id,
    role: (row.role === "assistant" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: row.content,
    created_at: createdAt,
    time_display: formatMessageTimePtBr(createdAt),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = (error as { code?: string }).code;
  return maybeCode === "23505";
}

export async function insertUserSafe(
  email: string,
  password: string,
  displayName: string | null,
): Promise<string | null> {
  const pool = await getPool();
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [normalizeEmail(email), displayName, hashPassword(password)],
    );
    return result.rows[0]?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return null;
    }
    throw error;
  }
}

export async function fetchUserByEmail(
  email: string,
): Promise<QueryResultRow | null> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, email, display_name, password_hash, created_at, updated_at
     FROM users
     WHERE email = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0] ?? null;
}

export async function fetchUserById(
  userId: string,
): Promise<QueryResultRow | null> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT id, email, display_name, password_hash, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<string | null> {
  const row = await fetchUserByEmail(email);
  if (!row?.password_hash || typeof row.password_hash !== "string") {
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) {
    return null;
  }
  return String(row.id);
}

export async function listAllChatSessions(
  userId: string,
  opts?: { limit?: number; offset?: number },
): Promise<SessionDto[]> {
  const pool = await getPool();
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 30));
  const offset = Math.max(0, opts?.offset ?? 0);
  const result = await pool.query<DbSession>(
    `SELECT id, title, created_at, updated_at
     FROM chat_sessions
     WHERE user_id = $1 AND archived_at IS NULL
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return result.rows.map(mapSessionRow);
}

export async function assertSessionOwned(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT 1
     FROM chat_sessions
     WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [sessionId, userId],
  );
  return Boolean(result.rows[0]);
}

export async function createChatSession(
  userId: string,
  title = "New Chat",
): Promise<string> {
  const pool = await getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_sessions (user_id, title)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, title],
  );
  return result.rows[0]?.id ?? randomUUID();
}

export async function updateChatSessionTitle(
  userId: string,
  sessionId: string,
  title: string,
): Promise<boolean> {
  const t = title.trim();
  if (!t) {
    return false;
  }
  const pool = await getPool();
  const result = await pool.query(
    `UPDATE chat_sessions
     SET title = $1
     WHERE id = $2 AND user_id = $3 AND archived_at IS NULL`,
    [t, sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteChatSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(
    `DELETE FROM chat_sessions
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listMessages(
  userId: string,
  sessionId: string,
  opts?: { limit?: number },
): Promise<ThreadMessageDto[]> {
  if (!(await assertSessionOwned(userId, sessionId))) {
    return [];
  }
  const pool = await getPool();
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 100));
  const result = await pool.query<DbMessage>(
    `SELECT id, session_id, role, content, model, token_usage_json, sequence_no, created_at
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY sequence_no DESC, created_at DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return result.rows.reverse().map(mapThreadMessageRow);
}

async function withSessionLock<T>(
  userId: string,
  sessionId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownership = await client.query(
      `SELECT 1
       FROM chat_sessions
       WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
       FOR UPDATE`,
      [sessionId, userId],
    );
    if (!ownership.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertMessage(args: {
  userId: string;
  sessionId: string;
  role: string;
  content: string;
  model?: string | null;
  tokenUsage?: Record<string, unknown> | null;
}): Promise<string | null> {
  const insertedId = await withSessionLock(
    args.userId,
    args.sessionId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO chat_messages (session_id, role, content, model, token_usage_json, sequence_no)
       VALUES (
         $1, $2, $3, $4, $5,
         (SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM chat_messages WHERE session_id = $1)
       )
       RETURNING id`,
        [
          args.sessionId,
          args.role,
          args.content,
          args.model ?? null,
          args.tokenUsage ?? null,
        ],
      );
      await client.query(
        `UPDATE chat_sessions
       SET updated_at = NOW()
       WHERE id = $1`,
        [args.sessionId],
      );
      return result.rows[0]?.id ?? null;
    },
  );
  return insertedId;
}
