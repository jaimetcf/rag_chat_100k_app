import { NextResponse } from "next/server";
import { DocumentServiceError, removeUserDocument } from "@/lib/documents";
import { currentUserIdFromCookie } from "@/lib/server-auth";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_: Request, { params }: Params) {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  try {
    const documents = await removeUserDocument(userId, id);
    return NextResponse.json(
      { ok: true, documents },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const status = error instanceof DocumentServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status });
  }
}
