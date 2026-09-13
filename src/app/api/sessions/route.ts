import { NextResponse } from "next/server";
import { createChatSession, listAllChatSessions } from "@/lib/repository";
import { currentUserIdFromCookie } from "@/lib/server-auth";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ sessions: [] });
  }
  const url = new URL(request.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const sessions = await listAllChatSessions(userId, { limit, offset });
  return NextResponse.json(
    { sessions, limit, offset },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}

export async function POST() {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const sessionId = await createChatSession(userId);
  return NextResponse.json({ sessionId });
}
