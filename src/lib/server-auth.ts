import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifyUserToken } from "@/lib/auth";

export async function currentUserIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifyUserToken(token);
}
