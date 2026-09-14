import { SharedArray } from "k6/data";
import exec from "k6/execution";
import http from "k6/http";
import { check, group, sleep } from "k6";
import type { Options } from "k6/options";
import {
  cookieHeaders,
  isSeededUser,
  jsonHeaders,
  parseSetCookie,
  type CookieJar,
  type SeededUser,
  fromProjectRoot,
} from "./lib.ts";

/**
 * Load test for rag_chat_100k using accounts from users.json.
 *
 * Run create-users.ts first, then from the app root:
 *   npm run load-test
 *
 * Env (from .env.local via dotenv, or the shell):
 *   BASE_URL     — app URL (default http://localhost:3000)
 *   K6_VUS       — peak virtual users (default 100)
 *   USERS_FILE   — seeded users (default load_tests/users.json)
 *   K6_MODEL     — chat model (default gpt-5.4-nano)
 */

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PEAK_VUS = Number(__ENV.K6_VUS || "100");
const MODEL = __ENV.K6_MODEL || "gpt-5.4-nano";
const USERS_FILE = __ENV.USERS_FILE || "load_tests/users.json";

const users = new SharedArray("seeded-users", () => {
  const parsed = JSON.parse(open(fromProjectRoot(USERS_FILE))) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.filter(isSeededUser);
});

const CODIGO_CIVIL_QUESTIONS = [
  "Segundo o Código Civil, quando começa a personalidade civil da pessoa e o que a lei assegura ao nascituro?",
  "Quem são os absolutamente incapazes de exercer pessoalmente os atos da vida civil?",
  "Em quais hipóteses a incapacidade do menor cessa antes dos 18 anos?",
  "O que a lei presume quando duas ou mais pessoas falecem na mesma ocasião, sem se poder averiguar quem morreu primeiro?",
  "Quais direitos da personalidade o Código Civil protege e eles podem ser transmitidos?",
  "Quais são os requisitos de validade do negócio jurídico no Código Civil?",
  "O que caracteriza o contrato de compra e venda segundo o Código Civil?",
  "Como o Código Civil trata a responsabilidade civil por ato ilícito?",
  "Qual é a ordem da vocação hereditária na sucessão legítima?",
  "O que é o usufruto e quais poderes ele confere ao usufrutuário?",
  "Quais deveres o Código Civil atribui aos cônjuges no casamento?",
  "Como se adquire a propriedade de um bem imóvel de acordo com o Código Civil?",
];

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
    http_req_duration: ["p(95)<120000"],
    checks: ["rate>0.85"],
  },
};

function login(user: SeededUser): CookieJar | null {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (loginRes.status !== 200) {
    return null;
  }
  return parseSetCookie(loginRes.headers as Record<string, string[] | string | undefined>);
}

function pickUser(): SeededUser {
  const index = (exec.vu.idInTest - 1 + exec.scenario.iterationInTest) % users.length;
  return users[index];
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
  if (!users.length) {
    exec.test.abort(`No users found in ${USERS_FILE}. Run create-users.ts first.`);
  }
  return { baseUrl: BASE_URL, userCount: users.length };
}

export default function () {
  const user = pickUser();
  const jar = login(user);
  const signedIn = check(jar, { "login 200": (value) => value !== null });
  if (!signedIn || !jar) {
    sleep(1);
    return;
  }

  const headers = jsonHeaders(jar);
  let sessionId = "";

  group("create chat", () => {
    const create = http.post(`${BASE_URL}/api/sessions`, null, { headers });
    check(create, { "create session": (r) => r.status === 200 });
    sessionId = (create.json() as { sessionId?: string })?.sessionId ?? "";
  });

  if (sessionId) {
    group("codigo civil questions", () => {
      for (const question of CODIGO_CIVIL_QUESTIONS) {
        const chat = http.post(
          `${BASE_URL}/api/chat`,
          JSON.stringify({
            question,
            model: MODEL,
            sessionId,
          }),
          { headers, timeout: "120s" }
        );
        check(chat, {
          "chat 200": (r) => r.status === 200,
          "same session": (r) => (r.json() as { sessionId?: string })?.sessionId === sessionId,
        });
        sleep(Math.random() * 0.4 + 0.2);
      }
    });
  }

  const logout = http.post(`${BASE_URL}/api/auth/logout`, null, { headers: cookieHeaders(jar) });
  check(logout, { "logout 200": (r) => r.status === 200 });
  sleep(Math.random() * 1.5 + 0.5);
}
