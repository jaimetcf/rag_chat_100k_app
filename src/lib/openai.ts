import { getOptionalEnv, getRequiredEnv } from "@/lib/env";
import { LLM_MODEL_CHOICES } from "@/lib/models";

export { LLM_MODEL_CHOICES };

export type ChatRole = "user" | "assistant";

export type ApiMessage = {
  role: ChatRole;
  content: string;
};

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const TITLE_SUMMARY_MODEL = "gpt-5.4-nano";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const TITLE_MAX_OUTPUT_TOKENS = 64;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_BATCH_SIZE = 64;

/** Tighter context window at 100k DAU to reduce token spend and latency. */
export const MAX_CONTEXT_MESSAGES = 24;

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;
let circuitFailures = 0;
let circuitOpenUntil = 0;

export function capSessionTitleWords(text: string, maxWords = 10): string {
  const words = (text || "").replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

export function trimMessagesForContext(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length <= MAX_CONTEXT_MESSAGES) {
    return messages;
  }
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { type?: string; message?: string };
};

function assertCircuitClosed() {
  if (Date.now() < circuitOpenUntil) {
    throw new Error("OpenAI circuit breaker open — try again shortly.");
  }
}

function recordSuccess() {
  circuitFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure() {
  circuitFailures += 1;
  if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    circuitFailures = 0;
  }
}

function extractTextFromResponse(data: OpenAIChatResponse): string {
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text && data.error?.message) {
    throw new Error(data.error.message);
  }
  return text;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMessage(args: {
  model: string;
  messages: ApiMessage[];
  maxTokens: number;
  system?: string;
}): Promise<string> {
  assertCircuitClosed();
  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  const maxAttempts = 3;
  const messages = [
    ...(args.system ? [{ role: "system" as const, content: args.system }] : []),
    ...args.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        max_completion_tokens: args.maxTokens,
        messages,
      }),
    });

    const raw = await response.text();
    let data: OpenAIChatResponse = {};
    if (raw) {
      try {
        data = JSON.parse(raw) as OpenAIChatResponse;
      } catch {
        recordFailure();
        throw new Error(`OpenAI returned non-JSON (HTTP ${response.status}).`);
      }
    }

    if (response.status === 429 || response.status >= 500) {
      recordFailure();
      if (attempt < maxAttempts) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
    }

    if (!response.ok) {
      recordFailure();
      const detail = data.error?.message ?? (raw.slice(0, 200) || response.statusText);
      throw new Error(`OpenAI API HTTP ${response.status}: ${detail}`);
    }

    const text = extractTextFromResponse(data);
    if (!text) {
      recordFailure();
      throw new Error("OpenAI API returned an empty assistant message.");
    }
    recordSuccess();
    return text;
  }

  recordFailure();
  throw new Error("OpenAI API unavailable after retries.");
}

export async function requestAssistantReply(
  messages: ApiMessage[],
  model: string,
  ragContext = ""
): Promise<string> {
  const base =
    getOptionalEnv("OPENAI_SYSTEM_PROMPT") ||
    "You are a helpful assistant. Answer concisely and clearly.";
  const system = ragContext.trim()
    ? `${base}

Use only the retrieved document excerpts below. If they cannot provide and/or help to provide the answer, explain the User that the knowledge base that is uploaded is not sufficient to provide the answer.

<retrieved_context>
${ragContext.trim()}
</retrieved_context>`
    : base;
  return createMessage({
    model,
    messages: trimMessagesForContext(messages),
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    system,
  });
}

type OpenAIEmbeddingResponse = {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
};

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const filtered = inputs.map((text) => text.trim()).filter(Boolean);
  if (!filtered.length) {
    return [];
  }
  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  const vectors: number[][] = [];

  for (let offset = 0; offset < filtered.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = filtered.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    let lastError = "OpenAI embeddings unavailable.";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
          encoding_format: "float",
        }),
      });
      const raw = await response.text();
      let data: OpenAIEmbeddingResponse = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as OpenAIEmbeddingResponse;
        } catch {
          lastError = `OpenAI embeddings returned non-JSON (HTTP ${response.status}).`;
          if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          throw new Error(lastError);
        }
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = data.error?.message ?? `OpenAI embeddings HTTP ${response.status}`;
        if (attempt < 3) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new Error(lastError);
      }
      if (!response.ok) {
        throw new Error(data.error?.message ?? `OpenAI embeddings HTTP ${response.status}`);
      }
      const batchVectors = (data.data ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((row) => row.embedding ?? []);
      if (batchVectors.length !== batch.length || batchVectors.some((row) => row.length === 0)) {
        throw new Error("OpenAI embeddings returned an incomplete batch.");
      }
      vectors.push(...batchVectors);
      lastError = "";
      break;
    }
    if (lastError) {
      throw new Error(lastError);
    }
  }
  return vectors;
}

export async function summarizeSessionTitle(userMessage: string): Promise<string> {
  if (!userMessage.trim()) {
    return "";
  }
  const title = await createMessage({
    model: TITLE_SUMMARY_MODEL,
    maxTokens: TITLE_MAX_OUTPUT_TOKENS,
    system:
      "Summarize the user's first chat message as a short session title (max 10 words). Reply with only the title, no quotes.",
    messages: [{ role: "user", content: userMessage.trim() }],
  });
  return capSessionTitleWords(title, 10);
}
