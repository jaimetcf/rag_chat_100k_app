import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import { formatSessionSidebarDate } from "@/lib/formatting";
import type { DocumentItem } from "@/types/documents";

type DbDocument = {
  id: string;
  file_name: string;
  gcs_path: string;
  mime_type: string | null;
  size_bytes: string | number | null;
  created_at: Date | string;
  chunk_count: string | number | null;
};

export type SimilarChunk = {
  content: string;
  fileName: string;
  similarity: number;
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function mapDocumentRow(row: DbDocument): DocumentItem {
  const createdAt = new Date(row.created_at).toISOString();
  return {
    id: row.id,
    name: row.file_name,
    sizeBytes: Number(row.size_bytes ?? 0),
    contentType: row.mime_type ?? "application/octet-stream",
    createdAt,
    createdDisplay: formatSessionSidebarDate(createdAt),
    chunkCount: Number(row.chunk_count ?? 0),
  };
}

export async function listDocumentsForUser(userId: string): Promise<DocumentItem[]> {
  const pool = await getPool();
  const result = await pool.query<DbDocument>(
    `SELECT d.id, d.file_name, d.gcs_path, d.mime_type, d.size_bytes, d.created_at,
            COUNT(c.id)::int AS chunk_count
     FROM documents d
     LEFT JOIN document_chunks c ON c.document_id = d.id
     WHERE d.user_id = $1
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapDocumentRow);
}

export async function countDocumentsForUser(userId: string): Promise<number> {
  const pool = await getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM documents WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function findDocumentByName(
  userId: string,
  fileName: string
): Promise<{ id: string; file_name: string; gcs_path: string } | null> {
  const pool = await getPool();
  const result = await pool.query<{ id: string; file_name: string; gcs_path: string }>(
    `SELECT id, file_name, gcs_path
     FROM documents
     WHERE user_id = $1 AND file_name = $2`,
    [userId, fileName]
  );
  return result.rows[0] ?? null;
}

export async function findDocumentById(
  userId: string,
  documentId: string
): Promise<{ id: string; file_name: string; gcs_path: string } | null> {
  const pool = await getPool();
  const result = await pool.query<{ id: string; file_name: string; gcs_path: string }>(
    `SELECT id, file_name, gcs_path
     FROM documents
     WHERE user_id = $1 AND id = $2`,
    [userId, documentId]
  );
  return result.rows[0] ?? null;
}

export async function deleteDocumentRecord(userId: string, documentId: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(
    `DELETE FROM documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function userHasChunks(userId: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT 1 FROM document_chunks WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return Boolean(result.rows[0]);
}

export async function insertDocumentWithChunks(args: {
  id?: string;
  userId: string;
  fileName: string;
  gcsPath: string;
  mimeType: string;
  sizeBytes: number;
  chunks: string[];
  embeddings: number[][];
  replaceDocumentId?: string | null;
}): Promise<string> {
  if (args.chunks.length !== args.embeddings.length) {
    throw new Error("Chunk and embedding counts do not match.");
  }
  const pool = await getPool();
  const client = await pool.connect();
  const documentId = args.id ?? randomUUID();
  try {
    await client.query("BEGIN");
    if (args.replaceDocumentId) {
      await client.query(`DELETE FROM documents WHERE id = $1 AND user_id = $2`, [
        args.replaceDocumentId,
        args.userId,
      ]);
    }
    await client.query(
      `INSERT INTO documents (id, user_id, file_name, gcs_path, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [documentId, args.userId, args.fileName, args.gcsPath, args.mimeType, args.sizeBytes]
    );
    if (args.chunks.length) {
      const batchSize = 25;
      for (let start = 0; start < args.chunks.length; start += batchSize) {
        const slice = args.chunks.slice(start, start + batchSize);
        const values: unknown[] = [];
        const placeholders = slice.map((content, sliceIndex) => {
          const index = start + sliceIndex;
          const offset = sliceIndex * 5;
          values.push(
            documentId,
            args.userId,
            index,
            content,
            toVectorLiteral(args.embeddings[index] ?? [])
          );
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::vector)`;
        });
        await client.query(
          `INSERT INTO document_chunks (document_id, user_id, chunk_index, content, embedding)
           VALUES ${placeholders.join(",")}`,
          values
        );
      }
    }
    await client.query("COMMIT");
    return documentId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function searchSimilarChunks(
  userId: string,
  embedding: number[],
  limit: number
): Promise<SimilarChunk[]> {
  const pool = await getPool();
  const result = await pool.query<{
    content: string;
    file_name: string;
    similarity: number;
  }>(
    `SELECT c.content, d.file_name,
            (1 - (c.embedding <=> $1::vector))::float8 AS similarity
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE c.user_id = $2
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(embedding), userId, limit]
  );
  return result.rows.map((row) => ({
    content: row.content,
    fileName: row.file_name,
    similarity: Number(row.similarity ?? 0),
  }));
}
