import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadChatGptConversationsExport } from "./chatgpt-export-input.js";

async function withExport(
  filename: string,
  text: string,
  run: (file: string, directory: string) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "branch-chatgpt-export-input-"));
  try {
    const file = path.join(directory, filename);
    await fs.writeFile(file, text);
    await run(file, directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe("ChatGPT export input", () => {
  const conversation = { id: "record-1", title: "A real imported record", mapping: {} };

  it.each(["conversations.json", "CONVERSATIONS.JSON", "export.JsOn"])(
    "reads the explicit export file %s",
    async (filename) => {
      await withExport(filename, JSON.stringify([conversation]), async (file) => {
        const parsed = await loadChatGptConversationsExport(file);
        expect(parsed.exportPath).toBe(file);
        expect(parsed.conversationsPath).toBe(file);
        expect(parsed.conversations).toEqual([conversation]);
      });
    },
  );

  it("retains directory input and strips a UTF-8 BOM before JSON parsing", async () => {
    await withExport("conversations.json", "\uFEFF" + JSON.stringify([conversation]), async (file, dir) => {
      const parsed = await loadChatGptConversationsExport(dir);
      expect(parsed.exportPath).toBe(dir);
      expect(parsed.conversationsPath).toBe(file);
      expect(parsed.conversations).toEqual([conversation]);
    });
  });

  it("selects explicit conversations ahead of unrelated array metadata", async () => {
    const wrapped = { labels: ["ignored metadata"], conversations: [conversation, null, false] };
    await withExport("export.json", JSON.stringify(wrapped), async (file) => {
      expect((await loadChatGptConversationsExport(file)).conversations).toEqual([conversation]);
    });
  });

  it("preserves the source fallback for an unknown export wrapper", async () => {
    await withExport("export.json", JSON.stringify({ records: [conversation, 42] }), async (file) => {
      expect((await loadChatGptConversationsExport(file)).conversations).toEqual([conversation]);
    });
  });

  it("continues rejecting unrecognized export structure with the actual source path", async () => {
    await withExport("export.json", "{\"labels\":{}}", async (file) => {
      await expect(loadChatGptConversationsExport(file)).rejects.toThrow(
        `Unrecognized ChatGPT conversations export format: ${file}`,
      );
    });
  });

  it("propagates malformed JSON instead of reporting a successful empty import", async () => {
    await withExport("export.json", "not JSON", async (file) => {
      await expect(loadChatGptConversationsExport(file)).rejects.toBeInstanceOf(SyntaxError);
    });
  });
});
