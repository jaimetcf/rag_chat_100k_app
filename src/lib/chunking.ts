export function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" ")
      );
      if (breakAt > chunkSize * 0.4) {
        end = start + breakAt + (window[breakAt] === "." ? 1 : 0);
      }
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
    if (chunks.length >= 200) {
      break;
    }
  }
  return chunks;
}
