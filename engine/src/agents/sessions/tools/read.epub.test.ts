import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { extractEpubText } from "../../../media/epub-extract.js";
import { createReadToolDefinition } from "./read.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

type Chapter = { id: string; href: string; html: string; mime?: string };
type BookOptions = {
  root?: string;
  prefix?: string;
  version?: string;
  spine?: string[];
  descriptors?: boolean;
};

async function epub(chapters: Chapter[], options: BookOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  const root = options.root ?? "OPS/book.opf";
  const prefix = options.prefix ?? "";
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${root}" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    root,
    `<${prefix}package xmlns${prefix ? ":opf" : ""}="http://www.idpf.org/2007/opf" version="${options.version ?? "2.0"}"><${prefix}manifest>${chapters.map((chapter) => `<${prefix}item id="${chapter.id}" href="${chapter.href}" media-type="${chapter.mime ?? "application/xhtml+xml"}"/>`).join("")}</${prefix}manifest><${prefix}spine>${(options.spine ?? chapters.map((chapter) => chapter.id)).map((id) => `<${prefix}itemref idref="${id}"/>`).join("")}</${prefix}spine></${prefix}package>`,
  );
  for (const chapter of chapters) {
    zip.file(path.posix.join(path.posix.dirname(root), chapter.href), chapter.html);
  }
  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    streamFiles: options.descriptors,
  });
}

const chapter = (id: string, html: string): Chapter => ({ id, href: `${id}.xhtml`, html });

async function readFixture(
  bytes: Buffer,
  args: { offset?: number; limit?: number; cursor?: number } = {},
  maxBytes?: number,
) {
  const directory = tempDirs.make("branch-epub-read-");
  await fs.writeFile(path.join(directory, "book.EPUB"), bytes);
  return await createReadToolDefinition(directory, { maxBytes }).execute(
    "epub",
    { path: "book.EPUB", ...args },
    undefined,
    undefined,
    {} as never,
  );
}

function text(result: Awaited<ReturnType<typeof readFixture>>): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("EPUB conversion through the authorized production file reader", () => {
  it.each(["2.0", "3.0"])("reads EPUB %s in spine order with HTML entities", async (version) => {
    const bytes = await epub(
      [
        chapter("second", "<p>Second &amp; last.</p>"),
        chapter("first", "<p>First <b>chapter</b>.</p>"),
      ],
      { version, spine: ["first", "second"] },
    );
    expect(text(await readFixture(bytes))).toBe("First chapter.\n\nSecond & last.");
  });

  it("reads namespaced OPF with a nested chapter path", async () => {
    const bytes = await epub(
      [{ id: "nested", href: "text/chapter.xhtml", html: "<p>Nested text.</p>" }],
      { prefix: "opf:" },
    );
    expect(text(await readFixture(bytes))).toBe("Nested text.");
  });

  it("reads archives whose packed sizes are only in the ZIP central directory", async () => {
    const bytes = await epub([chapter("one", "<p>Data descriptor export.</p>")], {
      descriptors: true,
    });
    expect(bytes.readUInt16LE(6) & 8).toBe(8);
    expect(bytes.readUInt32LE(18)).toBe(0);
    expect(text(await readFixture(bytes))).toBe("Data descriptor export.");
  });

  it("renders headings, links and script/style exclusions using upstream HTML conversion", async () => {
    const bytes = await epub([
      chapter(
        "one",
        '<h1>Heading</h1><p>Read <a href="https://example.com">here</a>.</p><script>hidden script</script><style>hidden style</style>',
      ),
    ]);
    expect(text(await readFixture(bytes))).toBe("HEADING\n\nRead here [https://example.com].");
  });

  it("preserves repeated spine references and ignores unreferenced manifest chapters", async () => {
    const bytes = await epub(
      [chapter("one", "<p>Repeat.</p>"), chapter("unused", "<p>Unused.</p>")],
      { spine: ["one", "absent", "one"] },
    );
    expect(text(await readFixture(bytes))).toBe("Repeat.\n\nRepeat.");
  });

  it("allows SVG chapters supported by the pinned parser", async () => {
    const bytes = await epub([
      {
        id: "one",
        href: "page.svg",
        mime: "image/svg+xml",
        html: '<svg xmlns="http://www.w3.org/2000/svg"><text>SVG chapter</text></svg>',
      },
    ]);
    expect(text(await readFixture(bytes))).toBe("SVG chapter");
  });

  it("uses offset and limit on converted content with continuation details", async () => {
    const bytes = await epub([chapter("one", "<p>First.</p><p>Second.</p><p>Third.</p>")]);
    const first = await readFixture(bytes, { limit: 1 });
    expect(text(first)).toContain("First.");
    expect(text(first)).not.toContain("Second.");
    expect(first.details).toMatchObject({ content: "First.", continuation: { offset: 2 } });
    expect(text(await readFixture(bytes, { offset: 3, limit: 1 }))).toContain("Second.");
  });

  it("continues inside long converted lines at the existing reader budget", async () => {
    const bytes = await epub([chapter("one", `<pre>${"abcdefghij".repeat(60)}</pre>`)]);
    const result = await readFixture(bytes, { limit: 1 }, 256);
    expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(256);
    expect(result.details).toMatchObject({ kind: "truncated", continuation: { offset: 1 } });
    const continuation =
      result.details.kind === "truncated" ? result.details.continuation : undefined;
    expect(continuation?.cursor).toBeGreaterThan(0);
    expect(text(await readFixture(bytes, continuation, 256))).toContain("abcdefghij");
  });

  it.each([Buffer.from("not a zip"), Buffer.alloc(0)])(
    "rejects invalid EPUB bytes instead of returning binary data",
    async (bytes) => {
      await expect(readFixture(bytes)).rejects.toThrow("No text content found in book.EPUB.");
    },
  );

  it("rejects books with no readable chapters using the upstream empty-content result", async () => {
    await expect(readFixture(await epub([]))).rejects.toThrow(
      "No text content found in book.EPUB.",
    );
  });

  it("rejects missing chapter entries and unsupported chapter MIME", async () => {
    const bytes = await epub([chapter("one", "<p>First.</p>")]);
    const zip = await JSZip.loadAsync(bytes);
    zip.remove("OPS/one.xhtml");
    await expect(readFixture(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(
      "No text content found",
    );
    await expect(
      readFixture(await epub([{ ...chapter("one", "<p>First.</p>"), mime: "text/plain" }])),
    ).rejects.toThrow("No text content found");
  });

  it("converts custom authorized backend bytes without reading local filesystem", async () => {
    const bytes = await epub([chapter("one", "<p>Remote book.</p>")]);
    const calls: string[] = [];
    const tool = createReadToolDefinition("/remote", {
      operations: {
        access: async (name) => {
          calls.push(`access:${name}`);
        },
        readFile: async (name) => {
          calls.push(`read:${name}`);
          return bytes;
        },
      },
    });
    const result = await tool.execute(
      "epub",
      { path: "book.epub" },
      undefined,
      undefined,
      {} as never,
    );
    expect(text(result)).toBe("Remote book.");
    const resolvedPath = path.resolve("/remote", "book.epub");
    expect(calls).toEqual([`access:${resolvedPath}`, `read:${resolvedPath}`]);
  });

  it("preserves access denial and cancellation before extracting any content", async () => {
    let reads = 0;
    const tool = createReadToolDefinition("/remote", {
      operations: {
        access: async () => {
          throw new Error("denied");
        },
        readFile: async () => {
          reads += 1;
          return Buffer.alloc(0);
        },
      },
    });
    await expect(
      tool.execute("epub", { path: "book.epub" }, undefined, undefined, {} as never),
    ).rejects.toThrow("denied");
    expect(reads).toBe(0);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(extractEpubText(Buffer.alloc(0), "book.epub", controller.signal)).rejects.toThrow(
      "cancelled",
    );
  });

  it("uses actual ZIP entry case when container rootfile spelling differs", async () => {
    const zip = await JSZip.loadAsync(
      await epub([chapter("one", "<p>Mixed case.</p>")], { root: "OEBPS/BOOK.OPF" }),
    );
    zip.file("mimetype", " APPLICATION/EPUB+ZIP\n");
    zip.file(
      "META-INF/container.xml",
      '<CONTAINER><ROOTFILES><ROOTFILE FULL-PATH="oebps/book.opf" MEDIA-TYPE="APPLICATION/OEBPS-PACKAGE+XML"/></ROOTFILES></CONTAINER>',
    );
    expect(text(await readFixture(await zip.generateAsync({ type: "nodebuffer" })))).toBe(
      "Mixed case.",
    );
  });

  it.each(["mimetype", "META-INF/container.xml", "OPS/book.opf"])(
    "reports an incomplete archive missing %s",
    async (entry) => {
      const zip = await JSZip.loadAsync(await epub([chapter("one", "<p>Text.</p>")]));
      zip.remove(entry);
      await expect(readFixture(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(
        "No text content found",
      );
    },
  );

  it("skips empty chapter bytes while preserving conversion spacing", async () => {
    expect(
      text(await readFixture(await epub([chapter("empty", ""), chapter("one", "<p>Text.</p>")]))),
    ).toBe("Text.");
    expect(
      await extractEpubText(
        await epub([chapter("one", "<script>x</script>"), chapter("two", "<style>y</style>")]),
        "book.epub",
      ),
    ).toBe("\n\n");
  });
});
