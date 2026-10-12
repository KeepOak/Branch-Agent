import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dedupeMetadata } from "./lib/model-metadata-dedupe.js";

function parseArgs(args: string[]): { rootDir: string; snapshotPath: string } {
  let rootDir = fileURLToPath(new URL("../", import.meta.url));
  let snapshotPath = "";
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--root" && flag !== "--litellm") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: model-metadata-dedupe.mts --litellm <local-json-file> [--root <engine-directory>]",
      );
    }
    if (flag === "--root") {
      rootDir = value;
    } else {
      snapshotPath = value;
    }
    index++;
  }
  if (!snapshotPath) {
    throw new Error("Required: --litellm <local-json-file>");
  }
  return { rootDir, snapshotPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  try {
    const result = await dedupeMetadata({
      ...args,
      output: (text) => process.stdout.write(`${text}\n`),
      answer: async (prompt) => {
        process.stdout.write(prompt);
        const line = await lines.next();
        return line.done ? "" : line.value;
      },
    });
    if (result.errors) {
      process.exitCode = 1;
    }
  } finally {
    input.close();
  }
}

await main().catch((error) => {
  process.stderr.write(`Metadata dedupe failed: ${String(error)}\n`);
  process.exitCode = 1;
});
