import { NextResponse } from "next/server";
import { issueUserToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { insertUserSafe } from "@/lib/repository";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");
  const displayNameRaw = String(body?.displayName ?? "").trim();
  const termsAccepted = Boolean(body?.termsAccepted ?? true);

  if (!termsAccepted) {
    return NextResponse.json(
      { error: "You must agree to the Terms and Conditions." },
      { status: 400 }
    );
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const userId = await insertUserSafe(email, password, displayNameRaw || null);
  if (!userId) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const token = issueUserToken(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
