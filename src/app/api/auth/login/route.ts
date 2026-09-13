import { NextResponse } from "next/server";
import { authenticateUser, fetchUserById } from "@/lib/repository";
import { issueUserToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const userId = await authenticateUser(email, password);
  if (!userId) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const user = await fetchUserById(userId);
  const token = issueUserToken(userId);
  const response = NextResponse.json({
    ok: true,
    email: String(user?.email ?? ""),
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
