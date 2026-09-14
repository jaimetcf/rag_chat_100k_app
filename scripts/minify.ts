const { readFileSync } = require("node:fs") as typeof import("node:fs");
const { resolve } = require("node:path") as typeof import("node:path");

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/minify.ts <file>");
  process.exit(1);
}

const raw = readFileSync(resolve(filePath), "utf8");

let minified: string;
try {
  minified = JSON.stringify(JSON.parse(raw));
} catch {
  minified = raw.replace(/\s+/g, " ").trim();
}

process.stdout.write(`${minified}\n`);
