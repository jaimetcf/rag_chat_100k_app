import { userHasChunks, searchSimilarChunks, type SimilarChunk } from "@/lib/document-repository";
import { embedTexts, type ApiMessage } from "@/lib/openai";

const RAG_TOP_K = 8;
const QUERY_CHAR_LIMIT = 6000;
const CONTEXT_CHAR_LIMIT = 8000;

export function historyToSearchQuery(messages: ApiMessage[]): string {
  return messages
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(0, QUERY_CHAR_LIMIT)
    .trim();
}

export async function retrieveRelevantChunks(
  userId: string,
  messages: ApiMessage[]
): Promise<SimilarChunk[]> {
  if (!(await userHasChunks(userId))) {
    return [];
  }
  const query = historyToSearchQuery(messages);
  if (!query) {
    return [];
  }
  const [embedding] = await embedTexts([query]);
  if (!embedding?.length) {
    return [];
  }
  return searchSimilarChunks(userId, embedding, RAG_TOP_K);
}

export function formatRagContext(chunks: SimilarChunk[]): string {
  if (!chunks.length) {
    return "";
  }
  let output = "";
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const block = `[${index + 1}] Source: ${chunk.fileName}\n${chunk.content}\n\n`;
    if (output.length + block.length > CONTEXT_CHAR_LIMIT) {
      break;
    }
    output += block;
  }
  return output.trim();
}
