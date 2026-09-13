import { NextResponse } from "next/server";
import { currentUserIdFromCookie } from "@/lib/server-auth";
import { fetchUserById } from "@/lib/repository";

export async function GET() {
  const userId = await currentUserIdFromCookie();
  if (!userId) {
    return NextResponse.json({ loggedIn: false });
  }
  const user = await fetchUserById(userId);
  if (!user) {
    return NextResponse.json({ loggedIn: false });
  }
  return NextResponse.json({
    loggedIn: true,
    userId,
    email: String(user.email ?? ""),
  });
}
