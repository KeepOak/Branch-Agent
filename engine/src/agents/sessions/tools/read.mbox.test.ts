import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import type { MboxDocument } from "../../../media/mbox-ingest.js";
import { mboxDocumentChunks } from "../../../media/mbox-read.js";
import { withFileMutationQueue } from "./file-mutation-queue.js";
import { collectOfficeReadPageText } from "./read-office-page.js";
import { createReadToolDefinition, type ReadOperations } from "./read.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
function message(subject: string, body: string): string {
  return `From sender@example.test Sat Jan 01 00:00:00 2022\nFrom: Sender <sender@example.test>\nSubject: ${subject}\n\n${body}\n`;
}
type Args = { offset?: number; limit?: number; cursor?: number; optional?: true };
function remote(bytes: Buffer, overrides: Partial<ReadOperations> = {}, maxBytes?: number) {
  return createReadToolDefinition("/remote", {
    maxBytes,
    operations: {
      resolvePath: async (name) => `/authorized/${name}`,
      access: async () => {},
      readFile: async () => bytes,
      ...overrides,
    },
  });
}
function execute(
  tool: ReturnType<typeof remote>,
  name = "mail.mbox",
  args: Args = {},
  signal?: AbortSignal,
) {
  return tool.execute("mbox-read", { path: name, ...args }, signal, undefined, {} as never);
}
function detailContent(result: Awaited<ReturnType<typeof execute>>): string {
  if (result.details.kind !== "text" && result.details.kind !== "truncated")
    throw new Error("Expected text page");
  return result.details.content;
}
function records(result: Awaited<ReturnType<typeof execute>>): MboxDocument[] {
  return detailContent(result)
    .split("\n")
    .map((line) => JSON.parse(line) as MboxDocument);
}

describe("MBOX through the actual authorized session read tool", () => {
  it.each(["mbox", "MBOX"])(
    "returns native complete records from .%s without modifying the archive",
    async (extension) => {
      const directory = tempDirs.make("branch-mbox-read-");
      const filePath = path.join(directory, `sample.${extension}`);
      const bytes = Buffer.from(message("Native", "real content"));
      await fs.writeFile(filePath, bytes);
      const result = await execute(createReadToolDefinition(directory), `sample.${extension}`);
      const stat = await fs.stat(filePath);
      expect(records(result)[0]).toMatchObject({
        title: "Native.mbox",
        url: `file://${filePath}`,
        published: stat.birthtimeMs ? stat.birthtime.toLocaleString() : "unknown",
        pageContent: "real content\n",
      });
      expect(await fs.readFile(filePath)).toEqual(bytes);
      expect(await fs.readdir(directory)).toEqual([`sample.${extension}`]);
    },
  );

  it("uses authorized backend bytes and date without ordinary text decoding", async () => {
    const events: string[] = [];
    const decodeText = vi.fn(() => "wrong decoder");
    const tool = remote(Buffer.from(message("Remote", "correct bytes")), {
      access: async () => {
        events.push("access");
      },
      readFile: async () => {
        events.push("read");
        return Buffer.from(message("Remote", "correct bytes"));
      },
      getCreationDate: async () => {
        events.push("date");
        return "backend birth date";
      },
      decodeText,
    });
    expect(records(await execute(tool))[0]).toMatchObject({
      published: "backend birth date",
      url: "file:///authorized/mail.mbox",
    });
    expect(events).toEqual(["access", "read", "date"]);
    expect(decodeText).not.toHaveBeenCalled();
  });

  it("detaches immutable bytes before asynchronous backend metadata", async () => {
    const bytes = Buffer.from(message("Original", "snapshot content"));
    const tool = remote(bytes, {
      getCreationDate: async () => {
        bytes.fill(0);
        return "date";
      },
    });
    expect(records(await execute(tool))[0]!.pageContent.trim()).toBe("snapshot content");
  });

  it("captures bytes and date before releasing the shared mutation queue", async () => {
    let bytes = Buffer.from(message("Snapshot", "before write"));
    let published = "before date";
    let releaseDate!: () => void;
    let started!: () => void;
    const dateGate = new Promise<void>((resolve) => {
      releaseDate = resolve;
    });
    const dateStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const tool = remote(bytes, {
      resolveQueueKey: () => "mbox-snapshot-queue",
      readFile: async () => bytes,
      getCreationDate: async () => {
        started();
        await dateGate;
        return published;
      },
    });
    const reading = execute(tool);
    await dateStarted;
    let changed = false;
    const writing = withFileMutationQueue("mbox-snapshot-queue", async () => {
      changed = true;
      bytes = Buffer.from(message("Changed", "after write"));
      published = "after date";
    });
    await Promise.resolve();
    expect(changed).toBe(false);
    releaseDate();
    const document = records(await reading)[0]!;
    expect(document).toMatchObject({ published: "before date", title: "Snapshot.mbox" });
    expect(document.pageContent.trim()).toBe("before write");
    await writing;
    expect(changed).toBe(true);
  });

  it("uses source unknown fallback for a synchronous backend metadata throw", async () => {
    const tool = remote(Buffer.from(message("x", "body")), {
      getCreationDate: () => {
        throw new Error("metadata unavailable");
      },
    });
    expect(records(await execute(tool))[0]!.published).toBe("unknown");
  });

  it.each([false, true])("uses unknown for missing or failed remote date (%s)", async (failed) => {
    const getCreationDate = failed
      ? async () => {
          throw new Error("metadata unavailable");
        }
      : undefined;
    expect(
      records(await execute(remote(Buffer.from(message("x", "body")), { getCreationDate })))[0]!
        .published,
    ).toBe("unknown");
  });

  it("preserves denial before any byte/date access", async () => {
    const readFile = vi.fn(async () => Buffer.from("From "));
    const getCreationDate = vi.fn(async () => "date");
    await expect(
      execute(
        remote(Buffer.alloc(0), {
          access: async () => {
            throw new Error("denied");
          },
          readFile,
          getCreationDate,
        }),
      ),
    ).rejects.toThrow("denied");
    expect(readFile).not.toHaveBeenCalled();
    expect(getCreationDate).not.toHaveBeenCalled();
  });

  it("preserves optional not-found without invoking conversion", async () => {
    const result = await execute(
      remote(Buffer.alloc(0), {
        access: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      }),
      "missing.mbox",
      { optional: true },
    );
    expect(result.details.kind).toBe("not_found");
  });

  it("rejects cancellation before and after byte capture", async () => {
    const first = new AbortController();
    first.abort();
    const readFile = vi.fn(async () => Buffer.from("From "));
    await expect(
      execute(remote(Buffer.alloc(0), { readFile }), "mail.mbox", {}, first.signal),
    ).rejects.toThrow("Operation aborted");
    expect(readFile).not.toHaveBeenCalled();
    const after = new AbortController();
    const getCreationDate = vi.fn(async () => "date");
    const tool = remote(Buffer.alloc(0), {
      getCreationDate,
      readFile: async () => {
        after.abort();
        return Buffer.from(message("Late", "body"));
      },
    });
    await expect(execute(tool, "mail.mbox", {}, after.signal)).rejects.toThrow("Operation aborted");
    expect(getCreationDate).not.toHaveBeenCalled();
  });

  it("preserves image and binary document admission for misleading suffixes", async () => {
    const pdf = await execute(remote(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj")));
    expect(detailContent(pdf)).toContain("binary document");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    );
    const result = await execute(remote(png));
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("image file"),
    });
    expect(result.content.some((block) => block.type === "image")).toBe(true);
  });

  it("retains ordinary text and avoids MBOX metadata for other readers", async () => {
    const getCreationDate = vi.fn(async () => "date");
    expect(
      detailContent(
        await execute(remote(Buffer.from("plain\nsecond"), { getCreationDate }), "normal.txt"),
      ),
    ).toBe("plain\nsecond");
    expect(getCreationDate).not.toHaveBeenCalled();
  });

  it("pages separate records and exposes exact continuation line counts", async () => {
    const tool = remote(Buffer.from(message("First", "one") + message("Second", "two")));
    const first = await execute(tool, "mail.mbox", { limit: 1 });
    expect(records(first).map((doc) => doc.title)).toEqual(["First.mbox"]);
    expect(first.details.kind).toBe("truncated");
    if (first.details.kind !== "truncated") throw new Error("Expected continuation");
    expect(first.details.truncation.totalLines).toBe(2);
    expect(first.details.continuation?.offset).toBe(2);
    expect(
      records(await execute(tool, "mail.mbox", { offset: 2 })).map((doc) => doc.title),
    ).toEqual(["Second.mbox"]);
  });

  it("continues long escaped Unicode records losslessly within the normal budget", async () => {
    const bytes = Buffer.from(message("Long", '😀a"\\'.repeat(3000)));
    const reference = detailContent(await execute(remote(bytes, {}, 100000)));
    const tool = remote(bytes, {}, 512);
    let cursor = 0;
    let rebuilt = "";
    for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
      const result = await execute(tool, "mail.mbox", { cursor });
      rebuilt += detailContent(result);
      expect(
        Buffer.byteLength(
          result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
        ),
      ).toBeLessThanOrEqual(512);
      if (result.details.kind !== "truncated" || !result.details.continuation) break;
      const continuation = result.details.continuation;
      expect(continuation.kind).toBe("cursor");
      if (continuation.kind !== "cursor") throw new Error("Expected cursor continuation");
      expect(continuation.cursor).toBeGreaterThan(cursor);
      cursor = continuation.cursor;
    }
    // Every source conversion creates a fresh UUID, with the same byte/character width.
    expect(JSON.parse(rebuilt)).toEqual({ ...JSON.parse(reference), id: JSON.parse(rebuilt).id });
  });

  it("counts later long records without retaining their unselected bodies", () => {
    const doc: MboxDocument = {
      id: "id",
      url: "url",
      title: "title",
      description: "desc",
      docSource: "source",
      chunkSource: "",
      published: "unknown",
      wordCount: 1,
      pageContent: "😀".repeat(100000),
      token_count_estimate: 25000,
    };
    const scan = collectOfficeReadPageText({
      chunks: mboxDocumentChunks([doc, doc, doc]),
      limit: 1,
      cursor: 0,
      maxBytes: 256,
      fileBytes: 1,
    });
    expect(scan.retainedChars).toBeLessThanOrEqual(258);
    expect(scan.line).toBe(3);
    expect(scan.firstLineLength).toBe(JSON.stringify(doc).length);
    expect(scan.selectedBytes).toBe(Buffer.byteLength(JSON.stringify(doc) + "\n"));
  });

  it("rejects a cursor splitting a serialized UTF-16 surrogate pair", async () => {
    const tool = remote(Buffer.from(message("Unicode", "body 😀 end")));
    const full = detailContent(await execute(tool));
    const cursor = full.indexOf("😀") + 1;
    expect(cursor).toBeGreaterThan(0);
    await expect(execute(tool, "mail.mbox", { cursor })).rejects.toThrow(
      "splits a UTF-16 surrogate pair",
    );
  });

  it("reports source failure and completes malformed EOF through the native caller", async () => {
    await expect(execute(remote(Buffer.alloc(0)))).rejects.toThrow(
      "No mail items found in mail.mbox.",
    );
    expect(detailContent(await execute(remote(Buffer.from("From "))))).toBe("[]");
    expect(
      records(
        await execute(remote(Buffer.from(message("Kept", "prior") + "From "))),
      )[0]!.pageContent.trim(),
    ).toBe("prior");
  });
});
