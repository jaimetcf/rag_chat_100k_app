import { randomUUID } from "node:crypto";
import { chunkText } from "@/lib/chunking";
import {
  deleteDocumentRecord,
  findDocumentById,
  findDocumentByName,
  insertDocumentWithChunks,
  listDocumentsForUser,
} from "@/lib/document-repository";
import { extractDocumentText, isSupportedDocument } from "@/lib/extract-text";
import { deleteUserGcsFile, uploadUserGcsFile } from "@/lib/gcs";
import { embedTexts } from "@/lib/openai";
import { MAX_FILE_BYTES, MAX_USER_DOCUMENTS } from "@/lib/documents-config";
import type { DocumentItem } from "@/types/documents";

export { MAX_FILE_BYTES, MAX_USER_DOCUMENTS };

export class DocumentServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "document";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").replace(/^\.+/g, "").trim();
  return (cleaned || "document").slice(0, 180);
}

export async function listUserDocuments(userId: string): Promise<DocumentItem[]> {
  return listDocumentsForUser(userId);
}

export async function ingestUploadedFiles(
  userId: string,
  files: File[]
): Promise<{ documents: DocumentItem[]; uploaded: string[]; errors: Array<{ name: string; error: string }> }> {
  if (!files.length) {
    throw new DocumentServiceError("Choose at least one file to upload.");
  }

  const prepared = files.map((file) => ({
    file,
    name: sanitizeFileName(file.name),
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  }));

  const current = await listDocumentsForUser(userId);
  const existingNames = new Set(current.map((doc) => doc.name));
  const newNames = prepared.filter((item) => !existingNames.has(item.name));
  if (current.length + newNames.length > MAX_USER_DOCUMENTS) {
    const remaining = Math.max(0, MAX_USER_DOCUMENTS - current.length);
    throw new DocumentServiceError(
      remaining === 0
        ? `You already have ${MAX_USER_DOCUMENTS} documents. Delete one to upload more.`
        : `You can upload ${remaining} more document${remaining === 1 ? "" : "s"} (maximum ${MAX_USER_DOCUMENTS}).`
    );
  }

  const uploaded: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const item of prepared) {
    try {
      if (!item.name) {
        throw new DocumentServiceError("File name is required.");
      }
      if (item.size <= 0) {
        throw new DocumentServiceError("That file is empty.");
      }
      if (item.size > MAX_FILE_BYTES) {
        throw new DocumentServiceError("Each file must be 10 MB or smaller.");
      }
      if (!isSupportedDocument(item.name, item.mimeType)) {
        throw new DocumentServiceError("Supported types: PDF, Markdown, TXT, CSV, JSON, HTML.");
      }

      const buffer = Buffer.from(await item.file.arrayBuffer());
      const text = await extractDocumentText({
        fileName: item.name,
        mimeType: item.mimeType,
        buffer,
      });
      if (!text) {
        throw new DocumentServiceError("Could not extract text from that file.");
      }

      const chunks = chunkText(text);
      if (!chunks.length) {
        throw new DocumentServiceError("The file did not contain enough text to index.");
      }
      const embeddings = await embedTexts(chunks);
      const existing = await findDocumentByName(userId, item.name);
      const documentId = randomUUID();
      const gcsPath = await uploadUserGcsFile({
        userId,
        fileName: item.name,
        buffer,
        contentType: item.mimeType,
        documentId,
      });
      try {
        await insertDocumentWithChunks({
          id: documentId,
          userId,
          fileName: item.name,
          gcsPath,
          mimeType: item.mimeType,
          sizeBytes: item.size,
          chunks,
          embeddings,
          replaceDocumentId: existing?.id ?? null,
        });
      } catch (error) {
        if (!existing) {
          await deleteUserGcsFile(userId, item.name);
        }
        throw error;
      }
      uploaded.push(item.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[documents] failed to ingest ${item.file.name || item.name}:`, message);
      errors.push({
        name: item.file.name || item.name,
        error: message,
      });
    }
  }

  return {
    documents: await listDocumentsForUser(userId),
    uploaded,
    errors,
  };
}

export async function removeUserDocument(userId: string, documentId: string): Promise<DocumentItem[]> {
  const existing = await findDocumentById(userId, documentId);
  if (!existing) {
    throw new DocumentServiceError("Document not found.", 404);
  }
  await deleteUserGcsFile(userId, existing.file_name);
  await deleteDocumentRecord(userId, existing.id);
  return listDocumentsForUser(userId);
}

