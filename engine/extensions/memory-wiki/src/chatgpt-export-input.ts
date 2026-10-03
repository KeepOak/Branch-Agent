// Input reader extracted from the pinned OpenClaw ChatGPT importer.
import fs from "node:fs/promises";
import path from "node:path";
import { asNullableRecord, isRecord } from "branch/plugin-sdk/string-coerce-runtime";

export async function loadChatGptConversationsExport(exportInputPath: string): Promise<{
  exportPath: string;
  conversationsPath: string;
  conversations: Record<string, unknown>[];
}> {
  const exportPath = path.resolve(exportInputPath);
  const conversationsPath = path.extname(exportPath).toLowerCase() === ".json"
    ? exportPath
    : path.join(exportPath, "conversations.json");
  const raw = await fs.readFile(conversationsPath, "utf8");
  // Windows text editors may save UTF-8 with a BOM; it is not JSON content.
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
  const wrapped = asNullableRecord(parsed);
  const conversations = Array.isArray(parsed)
    ? parsed
    : Array.isArray(wrapped?.conversations)
      ? wrapped.conversations
      : Object.values(wrapped ?? {}).find(Array.isArray);
  if (!conversations) {
    throw new Error(`Unrecognized ChatGPT conversations export format: ${conversationsPath}`);
  }
  return { exportPath, conversationsPath, conversations: conversations.filter(isRecord) };
}

