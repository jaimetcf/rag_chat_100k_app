import path from "node:path";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm"]);

export function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function isSupportedDocument(fileName: string, mimeType = ""): boolean {
  const ext = extensionOf(fileName);
  if (TEXT_EXTENSIONS.has(ext) || ext === ".pdf") {
    return true;
  }
  return /^(text\/|application\/(json|pdf)|application\/octet-stream)/i.test(mimeType);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  return Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text ?? "");
}

export async function extractDocumentText(args: {
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<string> {
  const ext = extensionOf(args.fileName);
  const mime = (args.mimeType ?? "").toLowerCase();

  if (ext === ".pdf" || mime.includes("pdf")) {
    return (await extractPdfText(args.buffer)).trim();
  }

  const raw = args.buffer.toString("utf8");
  if (ext === ".html" || ext === ".htm" || mime.includes("html")) {
    return stripHtml(raw);
  }
  if (ext === ".json" || mime.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw.trim();
    }
  }
  return raw.trim();
}
