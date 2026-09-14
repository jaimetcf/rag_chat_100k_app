/**
 * Distributed rate limiting for ~100k DAU.
 * Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for cross-instance limits.
 * Falls back to in-process buckets when Redis is not configured.
 */

type Bucket = {
  count: number;
  windowStartMs: number;
};

const localBuckets = new Map<string, Bucket>();
const MAX_LOCAL_BUCKETS = 50_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

function pruneLocal(now: number, windowMs: number) {
  if (localBuckets.size <= MAX_LOCAL_BUCKETS) {
    return;
  }
  for (const [key, bucket] of localBuckets) {
    if (now - bucket.windowStartMs > windowMs * 2) {
      localBuckets.delete(key);
    }
    if (localBuckets.size <= MAX_LOCAL_BUCKETS * 0.8) {
      break;
    }
  }
}

function checkLocal(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  pruneLocal(now, windowMs);
  const existing = localBuckets.get(key);
  if (!existing || now - existing.windowStartMs >= windowMs) {
    localBuckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    const retryAfterSec = Math.ceil((windowMs - (now - existing.windowStartMs)) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSec: 0 };
}

async function checkRedis(key: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!base || !token) {
    return null;
  }

  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const url = `${base.replace(/\/$/, "")}/pipeline`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(windowSec)],
    ]),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { result?: unknown[] };
  const count = Number((data.result?.[0] as { result?: number })?.result ?? 0);
  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSec: windowSec };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSec: 0 };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const redisResult = await checkRedis(key, limit, windowMs);
    if (redisResult) {
      return redisResult;
    }
  } catch {
    // Fall through to local limiter.
  }
  return checkLocal(key, limit, windowMs);
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/** Chat: sized so a 12-question session can complete; override with CHAT_RATE_LIMIT. */
export const CHAT_RATE_LIMIT = {
  limit: readPositiveInt(process.env.CHAT_RATE_LIMIT, 80),
  windowMs: readPositiveInt(process.env.CHAT_RATE_WINDOW_MS, 10 * 60 * 1000),
};

/** Auth endpoints: 10 attempts / 15 minutes per IP bucket (local only without Redis IP key). */
export const AUTH_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
