import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const FALLBACK_SECRET = "dev-only-insecure-secret-change-in-production";
export const SESSION_COOKIE_NAME = "tens_session";

function jwtSecret(): string {
  return process.env.AUTH_JWT_SECRET?.trim() || FALLBACK_SECRET;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain: string, passwordHash: string): boolean {
  try {
    return bcrypt.compareSync(plain, passwordHash);
  } catch {
    return false;
  }
}

export function issueUserToken(userId: string, ttlDays = 7): string {
  return jwt.sign({}, jwtSecret(), {
    algorithm: "HS256",
    subject: userId,
    expiresIn: `${ttlDays}d`,
  });
}

export function verifyUserToken(token: string | undefined | null): string | null {
  if (!token?.trim()) {
    return null;
  }
  try {
    const decoded = jwt.verify(token, jwtSecret(), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    const sub = decoded.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}
