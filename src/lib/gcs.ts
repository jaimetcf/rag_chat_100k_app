import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Storage, type StorageOptions } from "@google-cloud/storage";
import { getOptionalEnv, getRequiredEnv } from "@/lib/env";

let storage: Storage | null = null;

export type GcsObjectInfo = {
  name: string;
  gcsPath: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: string;
};

function parseServiceAccountJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes("private_key")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function resolveKeyFilePath(): string {
  const fromEnv =
    getOptionalEnv("GCP_SERVICE_ACCOUNT_KEY_FILE") ||
    getOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (!fromEnv) {
    return "";
  }
  const resolved = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  return existsSync(resolved) ? resolved : "";
}

export function parseGcpBucketPath(raw: string): { bucket: string; prefix: string } {
  const cleaned = raw.trim().replace(/^gs:\/\//i, "").replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    throw new Error("GCP_BUCKET_PATH is empty.");
  }
  const [bucket, ...rest] = cleaned.split("/").filter(Boolean);
  if (!bucket) {
    throw new Error("GCP_BUCKET_PATH is missing a bucket name.");
  }
  const prefix = rest.join("/") || "uploads";
  return { bucket, prefix };
}

export function getBucketConfig(): { bucket: string; prefix: string } {
  return parseGcpBucketPath(getRequiredEnv("GCP_BUCKET_PATH"));
}

export function userObjectPrefix(userId: string): string {
  const { prefix } = getBucketConfig();
  return `${prefix}/${userId}`;
}

export function userObjectPath(userId: string, fileName: string): string {
  return `${userObjectPrefix(userId)}/${fileName}`;
}

function wrapGcsError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/default credentials|Could not load the default credentials/i.test(message)) {
    throw new Error(
      "Google Cloud credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON file."
    );
  }
  if (/Unexpected token|is not valid JSON/i.test(message)) {
    throw new Error(
      "Could not parse GCP_SERVICE_ACCOUNT_JSON. Put the key file path in GOOGLE_APPLICATION_CREDENTIALS instead of pasting multiline JSON into .env.local."
    );
  }
  if (/403|Forbidden|does not have storage\.objects/i.test(message)) {
    throw new Error(
      "The service account cannot write to the GCS bucket. Grant it Storage Object Admin on rag_chat_docs."
    );
  }
  throw error instanceof Error ? error : new Error(message);
}

function getStorage(): Storage {
  if (storage) {
    return storage;
  }
  const projectId = getOptionalEnv("GCP_PROJECT_ID");
  const inline = parseServiceAccountJson(getOptionalEnv("GCP_SERVICE_ACCOUNT_JSON"));
  if (inline) {
    storage = new Storage({
      credentials: inline as StorageOptions["credentials"],
      projectId: projectId || String(inline.project_id ?? ""),
    });
    return storage;
  }

  const keyFile = resolveKeyFilePath();
  if (keyFile) {
    const fromFile = parseServiceAccountJson(readFileSync(keyFile, "utf8"));
    storage = new Storage({
      keyFilename: keyFile,
      ...(fromFile?.project_id || projectId
        ? { projectId: projectId || String(fromFile?.project_id ?? "") }
        : {}),
    });
    return storage;
  }

  storage = new Storage({
    ...(projectId ? { projectId } : {}),
  });
  return storage;
}

export async function listUserGcsFiles(userId: string): Promise<GcsObjectInfo[]> {
  const { bucket, prefix } = getBucketConfig();
  const folder = `${prefix}/${userId}/`;
  try {
    const [files] = await getStorage().bucket(bucket).getFiles({ prefix: folder });
    return files
      .filter((file) => file.name && !file.name.endsWith("/"))
      .map((file) => {
        const name = file.name.slice(folder.length);
        return {
          name,
          gcsPath: file.name,
          sizeBytes: Number(file.metadata.size ?? 0),
          contentType: String(file.metadata.contentType ?? "application/octet-stream"),
          updatedAt: String(file.metadata.updated ?? new Date().toISOString()),
        };
      })
      .filter((file) => file.name && !file.name.includes("/"));
  } catch (error) {
    wrapGcsError(error);
  }
}

export async function uploadUserGcsFile(args: {
  userId: string;
  fileName: string;
  buffer: Buffer;
  contentType: string;
  documentId: string;
}): Promise<string> {
  const { bucket } = getBucketConfig();
  const gcsPath = userObjectPath(args.userId, args.fileName);
  try {
    await getStorage()
      .bucket(bucket)
      .file(gcsPath)
      .save(args.buffer, {
        resumable: false,
        contentType: args.contentType,
        metadata: {
          metadata: {
            userId: args.userId,
            documentId: args.documentId,
          },
        },
      });
  } catch (error) {
    wrapGcsError(error);
  }
  return gcsPath;
}

export async function deleteUserGcsFile(userId: string, fileName: string): Promise<void> {
  const { bucket } = getBucketConfig();
  try {
    await getStorage().bucket(bucket).file(userObjectPath(userId, fileName)).delete({
      ignoreNotFound: true,
    });
  } catch (error) {
    wrapGcsError(error);
  }
}
