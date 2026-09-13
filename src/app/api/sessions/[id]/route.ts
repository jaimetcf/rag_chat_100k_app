import { NextResponse } from "next/server";
import { deleteChatSession, listMessages } from "@/lib/repository";
import { currentUserIdFromCookie } from "@/lib/server-auth";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ messages: [] });
  }
  const { id } = await params;
  const messages = await listMessages(userId, id);
  return NextResponse.json({ messages });
}

export async function DELETE(_: Request, { params }: Params) {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const deleted = await deleteChatSession(userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Could not delete that session." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
