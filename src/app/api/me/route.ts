import { NextResponse } from "next/server";
import { currentUserIdFromCookie } from "@/lib/server-auth";
import { fetchUserById } from "@/lib/repository";

export const dynamic = "force-dynamic";

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    },
  });
}

export async function GET() {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return json({ loggedIn: false });
  }
  const user = await fetchUserById(userId);
  if (!user) {
    return json({ loggedIn: false });
  }
  return json({
    loggedIn: true,
    userId,
    email: String(user.email ?? ""),
  });
}
