import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import type { Options } from "k6/options";
import {
  cookieHeaders,
  emailFor,
  parseSetCookie,
  type CookieJar,
  type SeededUser,
  fromProjectRoot,
} from "./lib.ts";

/**
 * Seed 100 load-test users, upload codigo_civil.md for each, and write users.json.
 * Users are created one at a time, 6s after the previous one finishes.
 *
 * Run from the app root so file paths resolve:
 *   npm run create-users
 *
 * Env (from .env.local via dotenv, or the shell):
 *   BASE_URL         — app URL (default http://localhost:3000)
 *   K6_USER_COUNT    — users to create (default 100)
 *   K6_SEED_GAP_SEC  — wait between users (default 6)
 *   K6_DOC_PATH      — markdown file to upload (default load_tests/codigo_civil.md)
 *   USERS_FILE       — output path (default load_tests/users.json)
 */

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const USER_COUNT = Math.max(1, Number(__ENV.K6_USER_COUNT || "100"));
const SEED_GAP_SEC = Math.max(0, Number(__ENV.K6_SEED_GAP_SEC || "6"));
const USERS_FILE = __ENV.USERS_FILE || "load_tests/users.json";
const PASSWORD = "loadtest-password-12";
const DOC_NAME = "codigo_civil.md";
const DOC_BYTES = open(fromProjectRoot(__ENV.K6_DOC_PATH || "load_tests/codigo_civil.md"), "b");

export const options: Options = {
  scenarios: {
    seed_users: {
      executor: "shared-iterations",
      vus: 1,
      iterations: USER_COUNT,
      maxDuration: "4h",
    },
  },
  thresholds: {
    checks: ["rate>0.85"],
  },
};

function registerOrLogin(email: string): CookieJar | null {
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email,
      password: PASSWORD,
      displayName: `K6 User ${email}`,
      termsAccepted: true,
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (registerRes.status === 200) {
    return parseSetCookie(registerRes.headers as Record<string, string[] | string | undefined>);
  }

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (loginRes.status !== 200) {
    return null;
  }
  return parseSetCookie(loginRes.headers as Record<string, string[] | string | undefined>);
}

function hasCodigoCivil(jar: CookieJar): boolean {
  const docs = http.get(`${BASE_URL}/api/documents`, { headers: cookieHeaders(jar) });
  const names = ((docs.json() as { documents?: Array<{ name?: string }> })?.documents ?? []).map(
    (doc) => doc.name
  );
  return names.includes(DOC_NAME);
}

function collectSeededUsers(): SeededUser[] {
  const users: SeededUser[] = [];
  for (let index = 0; index < USER_COUNT; index += 1) {
    const email = emailFor(index);
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password: PASSWORD }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (loginRes.status !== 200) {
      continue;
    }
    const jar = parseSetCookie(loginRes.headers as Record<string, string[] | string | undefined>);
    const me = http.get(`${BASE_URL}/api/me`, { headers: cookieHeaders(jar) });
    const userId = (me.json() as { userId?: string })?.userId;
    if (userId) {
      users.push({ userId, email, password: PASSWORD });
    }
    http.post(`${BASE_URL}/api/auth/logout`, null, { headers: cookieHeaders(jar) });
  }
  return users;
}

export function setup() {
  const health = http.get(`${BASE_URL}/api/health`);
  const healthy = check(health, {
    "health ok": (r) => r.status === 200,
    "tier rag_chat_100k": (r) => (r.json() as { tier?: string })?.tier === "rag_chat_100k",
  });
  if (!healthy) {
    exec.test.abort(`Health check failed against ${BASE_URL}`);
  }
  return { baseUrl: BASE_URL, userCount: USER_COUNT };
}

export default function () {
  const index = exec.scenario.iterationInTest;
  const email = emailFor(index);

  const jar = registerOrLogin(email);
  const signedIn = check(jar, { "register or login": (value) => value !== null });
  if (!signedIn || !jar) {
    waitBeforeNextUser(index);
    return;
  }

  const me = http.get(`${BASE_URL}/api/me`, { headers: cookieHeaders(jar) });
  check(me, {
    "me has userId": (r) => Boolean((r.json() as { userId?: string })?.userId),
  });

  if (!hasCodigoCivil(jar)) {
    const upload = http.post(
      `${BASE_URL}/api/documents`,
      { files: http.file(DOC_BYTES, DOC_NAME, "text/markdown") },
      { headers: cookieHeaders(jar), timeout: "180s" }
    );
    check(upload, {
      "upload 200": (r) => r.status === 200,
      "uploaded codigo_civil.md": (r) => {
        const body = r.json() as { uploaded?: string[] };
        return Boolean(body.uploaded?.includes(DOC_NAME));
      },
    });
  }

  const logout = http.post(`${BASE_URL}/api/auth/logout`, null, { headers: cookieHeaders(jar) });
  check(logout, { "logout 200": (r) => r.status === 200 });
  waitBeforeNextUser(index);
}

function waitBeforeNextUser(index: number) {
  if (index < USER_COUNT - 1 && SEED_GAP_SEC > 0) {
    sleep(SEED_GAP_SEC);
  }
}

export function handleSummary(data: {
  metrics?: Record<string, { values?: Record<string, number> }>;
}) {
  const users = collectSeededUsers();
  const failedRate = data.metrics?.http_req_failed?.values?.rate;
  const p95 = data.metrics?.http_req_duration?.values?.["p(95)"];
  const stdout = [
    `Wrote ${users.length}/${USER_COUNT} users to ${USERS_FILE}`,
    failedRate === undefined ? "" : `http_req_failed: ${(failedRate * 100).toFixed(2)}%`,
    p95 === undefined ? "" : `http_req_duration p95: ${p95.toFixed(0)}ms`,
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    [USERS_FILE]: `${JSON.stringify(users, null, 2)}\n`,
    stdout: `${stdout}\n`,
  };
}
