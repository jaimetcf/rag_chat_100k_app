import http from "k6/http";
import { check, group, sleep } from "k6";
import type { Options } from "k6/options";
import { cookieHeader, jsonBody, parseSetCookie } from "./lib.ts";

/**
 * Load test for rag_chat_100k (~100k DAU target).
 *
 * Env:
 *   BASE_URL          — deployed Vercel URL (required for realistic runs)
 *   K6_CHAT_ENABLED   — "true" to hit /api/chat (OpenAI; expensive)
 *   K6_VUS            — peak virtual users (default 400; tune to infra)
 */

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const CHAT_ENABLED = (__ENV.K6_CHAT_ENABLED || "false").toLowerCase() === "true";
const PEAK_VUS = Number(__ENV.K6_VUS || "400");

export const options: Options = {
  scenarios: {
    rag_chat_100k_dau: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: Math.floor(PEAK_VUS * 0.1) },
        { duration: "5m", target: Math.floor(PEAK_VUS * 0.35) },
        { duration: "8m", target: PEAK_VUS },
        { duration: "3m", target: Math.floor(PEAK_VUS * 0.5) },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "45s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<12000"],
    checks: ["rate>0.85"],
  },
};

type AuthState = {
  email: string;
  jar: Record<string, string>;
};

function registerAndLogin(): AuthState | null {
  const email = `k6-${__VU}-${__ITER}-${Date.now()}@loadtest.local`;
  const password = "loadtest-password-12";

  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email,
      password,
      displayName: "K6 User",
      termsAccepted: true,
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (registerRes.status !== 200) {
    return null;
  }

  const jar = parseSetCookie(registerRes.headers as Record<string, string[] | string | undefined>);
  return { email, jar };
}

export function setup() {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, {
    "health ok": (r) => r.status === 200,
    "tier rag_chat_100k": (r) => jsonBody<{ tier?: string }>(r)?.tier === "rag_chat_100k",
  });
  return { baseUrl: BASE_URL };
}

export default function () {
  const auth = registerAndLogin();
  if (!auth) {
    sleep(1);
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Cookie: cookieHeader(auth.jar),
  };

  group("read APIs", () => {
    const me = http.get(`${BASE_URL}/api/me`, { headers });
    check(me, { "me 200": (r) => r.status === 200 });

    const sessions = http.get(`${BASE_URL}/api/sessions?limit=15&offset=0`, { headers });
    check(sessions, { "sessions 200": (r) => r.status === 200 });

    const create = http.post(`${BASE_URL}/api/sessions`, null, { headers });
    check(create, { "create session": (r) => r.status === 200 });
    const sessionId = jsonBody<{ sessionId?: string }>(create)?.sessionId;
    if (sessionId) {
      const thread = http.get(`${BASE_URL}/api/sessions/${sessionId}`, { headers });
      check(thread, { "thread 200": (r) => r.status === 200 });
    }
  });

  if (CHAT_ENABLED) {
    group("chat API (OpenAI)", () => {
      const chat = http.post(
        `${BASE_URL}/api/chat`,
        JSON.stringify({
          question: "Reply with exactly one word: pong",
          model: "gpt-5.4-nano",
        }),
        { headers, timeout: "120s" }
      );
      check(chat, {
        "chat 200": (r) => r.status === 200,
        "has sessionId": (r) => Boolean(jsonBody<{ sessionId?: string }>(r)?.sessionId),
      });
    });
  }

  sleep(Math.random() * 1.5 + 0.5);
}
