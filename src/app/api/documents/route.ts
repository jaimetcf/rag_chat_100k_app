import { NextResponse } from "next/server";
import {
  DocumentServiceError,
  ingestUploadedFiles,
  listUserDocuments,
  MAX_USER_DOCUMENTS,
} from "@/lib/documents";
import { currentUserIdFromCookie } from "@/lib/server-auth";

export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  try {
    const documents = await listUserDocuments(userId);
    return NextResponse.json(
      { documents, maxDocuments: MAX_USER_DOCUMENTS },
      NO_STORE
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size >= 0);
    const result = await ingestUploadedFiles(userId, files);
    const status = result.uploaded.length ? 200 : 400;
    return NextResponse.json(
      { ...result, maxDocuments: MAX_USER_DOCUMENTS },
      { status, ...NO_STORE }
    );
  } catch (error) {
    const status = error instanceof DocumentServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status });
  }
}
