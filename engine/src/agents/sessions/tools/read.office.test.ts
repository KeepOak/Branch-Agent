// Behavior ported from Kilo-Org/kilocode 6fd9b7b: test/kilocode/read-{docx,xlsx}.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { write, utils, type WorkBook, type WorkSheet } from "xlsx";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { extractOfficeContent } from "../../../media/office-extract.js";
import { createReadToolDefinition } from "./read.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function docx(paragraphs: string[], extra = "", descriptors = false): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("") +
      extra +
      "</w:body></w:document>",
  );
  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    streamFiles: descriptors,
  });
}

function book(sheet: WorkSheet): WorkBook {
  const result = utils.book_new();
  utils.book_append_sheet(result, sheet, "Visible");
  return result;
}

function workbookBytes(value: WorkBook, format: "xlsx" | "ods" = "xlsx"): Buffer {
  return Buffer.from(write(value, { type: "buffer", bookType: format }) as Uint8Array);
}

async function readFixture(
  bytes: Buffer,
  name: string,
  args: { offset?: number; limit?: number; cursor?: number } = {},
) {
  const directory = tempDirs.make("branch-office-read-");
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes);
  return await createReadToolDefinition(directory).execute(
    "office-read",
    { path: name, ...args },
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

async function repackDescriptors(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
}

describe("Office reads through the production session read tool", () => {
  it.each(["docx", "DOCX"])("extracts paragraphs from .%s files", async (extension) => {
    const result = await readFixture(
      await docx(["First paragraph", "Second paragraph"]),
      `sample.${extension}`,
    );
    expect(text(result)).toContain("First paragraph");
    expect(text(result)).toContain("Second paragraph");
    expect(result.details.kind).toBe("text");
    expect(result.content.every((block) => block.type === "text")).toBe(true);
  });

  it("paginates DOCX text and continues from the returned offset", async () => {
    const bytes = await docx(["First paragraph", "Second paragraph"]);
    const first = await readFixture(bytes, "paged.docx", { limit: 1 });
    expect(text(first)).toContain("First paragraph");
    expect(text(first)).not.toContain("Second paragraph");
    expect(first.details.kind).toBe("truncated");
    const continuation =
      first.details.kind === "truncated" ? first.details.continuation : undefined;
    expect(continuation?.offset).toBe(2);
    const next = await readFixture(bytes, "paged.docx", { offset: continuation!.offset });
    expect(text(next)).toContain("Second paragraph");
    expect(text(next)).not.toContain("First paragraph");
  });

  it("reports malformed DOCX and preserves extraction warnings", async () => {
    await expect(readFixture(Buffer.from([0x50, 0x4b, 3, 4]), "invalid.docx")).rejects.toThrow(
      "Failed to extract text from DOCX file",
    );
    const result = await readFixture(
      await docx(["Readable text"], "<w:unsupported/>"),
      "warning.docx",
    );
    expect(text(result)).toContain("Readable text");
    expect(text(result)).toContain("DOCX extraction warnings");
  });

  it("reads DOCX ZIP data descriptors using central-directory sizes", async () => {
    const bytes = await docx(["Descriptor document"], "", true);
    expect(bytes.readUInt16LE(6) & 8).toBe(8);
    expect(bytes.readUInt32LE(18)).toBe(0);
    expect(text(await readFixture(bytes, "descriptor.docx"))).toContain("Descriptor document");
  });

  it.each(["xlsx", "ods"] as const)("extracts formatted cells from .%s", async (format) => {
    const sheet: WorkSheet = {
      A1: { t: "s", v: "Link", l: { Target: "https://kilo.ai" } },
      B1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z") },
      C1: { t: "n", v: 42, ...(format === "xlsx" ? { f: "SUM(40,2)" } : {}) },
      A4: { t: "s", v: "After blank row" },
      "!ref": "A1:C4",
    };
    const result = await readFixture(
      workbookBytes(book(sheet), format),
      `report.${format.toUpperCase()}`,
    );
    expect(text(result)).toContain("--- Sheet: Visible ---");
    expect(text(result)).toContain("Link (https://kilo.ai)");
    expect(text(result)).toContain("2026-05-29");
    expect(text(result)).toContain("42");
    expect(text(result)).toContain("After blank row");
  });

  it("retains uncached formulas and spreadsheet errors", async () => {
    const sheet: WorkSheet = {
      A1: { t: "n", f: "SUM(B1:B1)" },
      B1: { t: "e", v: 0x07, w: "#DIV/0!" },
      "!ref": "A1:B1",
    };
    const result = await readFixture(workbookBytes(book(sheet)), "formulas.xlsx");
    expect(text(result)).toContain("[Formula: SUM(B1:B1)]");
    expect(text(result)).toContain("[Error: #DIV/0!]");
  });

  it("omits hidden and very-hidden XLSX sheets", async () => {
    const value = book(utils.aoa_to_sheet([["Visible content"]]));
    utils.book_append_sheet(value, utils.aoa_to_sheet([["Hidden content"]]), "Hidden");
    utils.book_append_sheet(value, utils.aoa_to_sheet([["Secret content"]]), "Secret");
    value.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] };
    const result = await readFixture(workbookBytes(value), "hidden.xlsx");
    expect(text(result)).toContain("Visible content");
    expect(text(result)).not.toContain("Hidden content");
    expect(text(result)).not.toContain("Secret content");
  });

  it.each(["xlsx", "ods"] as const)("uses normal paging for %s text", async (format) => {
    const bytes = workbookBytes(book(utils.aoa_to_sheet([["one"], ["two"], ["three"]])), format);
    const first = await readFixture(bytes, `limited.${format}`, { limit: 2 });
    expect(text(first)).toContain("--- Sheet: Visible ---\none");
    expect(text(first)).not.toContain("two");
    expect(first.details.kind).toBe("truncated");
    const next = await readFixture(bytes, `limited.${format}`, { offset: 3, limit: 1 });
    expect(text(next)).toContain("two");
    expect(text(next)).not.toContain("three");
  });

  it.each(["xlsx", "ods"] as const)(
    "retains the source 50k row bound for sparse %s",
    async (format) => {
      const sheet: WorkSheet = {
        A1: { t: "s", v: "first" },
        A50000: { t: "s", v: "row-50000" },
        A50001: { t: "s", v: "last" },
        "!ref": "A1:A50001",
      };
      let bytes = workbookBytes(book(sheet), format);
      // Like the upstream fixture, widen the stored dimension after writing its sparse cells.
      if (format === "xlsx") {
        const zip = await JSZip.loadAsync(bytes);
        const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
        zip.file("xl/worksheets/sheet1.xml", xml.replace('ref="A1:A50001"', 'ref="A1:XFD50001"'));
        bytes = await zip.generateAsync({ type: "nodebuffer" });
      }
      const result = await readFixture(bytes, `sparse.${format}`);
      expect(text(result)).toContain("first");
      expect(text(result)).toContain("row-50000");
      expect(text(result)).not.toContain("\nlast");
      expect(text(result)).toContain("[... truncated at row 50000 ...]");
    },
  );

  it.each(["xlsx", "ods"] as const)("reports malformed and oversized %s input", async (format) => {
    await expect(readFixture(Buffer.from([0x50, 0x4b, 3, 4]), `invalid.${format}`)).rejects.toThrow(
      "Cannot read spreadsheet file",
    );
    const oversized = Buffer.alloc(50 * 1024 * 1024 + 1);
    oversized.write("PK");
    await expect(readFixture(oversized, `large.${format}`)).rejects.toThrow(
      "exceeds the 50 MB size limit",
    );
  });

  it.each(["xlsx", "ods"] as const)(
    "reads %s ZIP data descriptors using central-directory sizes",
    async (format) => {
      const bytes = await repackDescriptors(
        workbookBytes(book(utils.aoa_to_sheet([["Descriptor workbook"]])), format),
      );
      expect(bytes.readUInt16LE(6) & 8).toBe(8);
      expect(bytes.readUInt32LE(18)).toBe(0);
      expect(text(await readFixture(bytes, `descriptor.${format}`))).toContain(
        "Descriptor workbook",
      );
    },
  );

  it("extracts all visible ODS sheets and repeated nonempty cells", async () => {
    const value = book(utils.aoa_to_sheet([[1, 1]]));
    utils.book_append_sheet(value, utils.aoa_to_sheet([["Other content"]]), "Other");
    const zip = await JSZip.loadAsync(workbookBytes(value, "ods"));
    const content = await zip.file("content.xml")!.async("string");
    zip.file(
      "content.xml",
      content
        .replace(
          /(<table:table-cell[^>]*office:value="1"[^>]*>[\s\S]*?<\/table:table-cell>)(<table:table-cell[^>]*office:value="1"[^>]*>[\s\S]*?<\/table:table-cell>)/,
          "$1",
        )
        .replace(
          /(<table:table-cell)([^>]*office:value="1")/,
          '$1 table:number-columns-repeated="2"$2',
        ),
    );
    const result = await readFixture(
      await zip.generateAsync({ type: "nodebuffer" }),
      "repeated.ods",
    );
    expect(text(result)).toContain("1\t1");
    expect(text(result)).toContain("Other content");
  });

  it("omits ODS sheets hidden by a table style", async () => {
    const value = book(utils.aoa_to_sheet([["Visible content"]]));
    utils.book_append_sheet(value, utils.aoa_to_sheet([["Invisible content"]]), "Hidden");
    const zip = await JSZip.loadAsync(workbookBytes(value, "ods"));
    const xml = await zip.file("content.xml")!.async("string");
    const style =
      '<style:style style:name="hidden" style:family="table"><style:table-properties table:display="false"/></style:style>';
    zip.file(
      "content.xml",
      xml
        .replace("</office:automatic-styles>", `${style}</office:automatic-styles>`)
        .replace(
          /(<table:table\s[^>]*table:name="Hidden"[^>]*table:style-name=")[^"]*(")/,
          "$1hidden$2",
        ),
    );
    const result = await readFixture(await zip.generateAsync({ type: "nodebuffer" }), "hidden.ods");
    expect(text(result)).toContain("Visible content");
    expect(text(result)).not.toContain("Invisible content");
  });

  it("uses backend bytes and preserves its access check for Office files", async () => {
    let reads = 0;
    const tool = createReadToolDefinition("/sandbox", {
      operations: {
        access: async () => {
          throw new Error("backend access denied");
        },
        readFile: async () => {
          reads += 1;
          return await docx(["Never disclosed"]);
        },
      },
    });
    await expect(
      tool.execute("read", { path: "protected.docx" }, undefined, undefined, {} as never),
    ).rejects.toThrow("backend access denied");
    expect(reads).toBe(0);
  });

  it("extracts remote backend snapshots without using the backend text decoder", async () => {
    const bytes = await docx(["Remote document"]);
    let decoded = false;
    const tool = createReadToolDefinition("/sandbox", {
      operations: {
        access: async () => {},
        readFile: async () => bytes,
        decodeText: () => {
          decoded = true;
          return "ZIP bytes decoded as text";
        },
      },
    });
    const result = await tool.execute(
      "read",
      { path: "remote.docx" },
      undefined,
      undefined,
      {} as never,
    );
    expect(text(result)).toContain("Remote document");
    expect(decoded).toBe(false);
  });

  it("keeps sparse wide spreadsheet extraction lazy before the reader selects one line", async () => {
    const zip = await JSZip.loadAsync(workbookBytes(book(utils.aoa_to_sheet([["first"]]))));
    const rows = Array.from(
      { length: 128 },
      (_, index) =>
        `<row r="${index + 1}"><c r="XFD${index + 1}" t="str"><v>row-${index + 1}</v></c></row>`,
    ).join("");
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    zip.file(
      "xl/worksheets/sheet1.xml",
      xml.replace('ref="A1"', 'ref="A1:XFD128"').replace("</sheetData>", `${rows}</sheetData>`),
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const extracted = await extractOfficeContent("wide.xlsx", bytes);
    expect(extracted?.kind).toBe("stream");
    if (extracted?.kind !== "stream") {
      throw new Error("Spreadsheet extraction must remain iterable");
    }
    const iterator = extracted.chunks[Symbol.iterator]();
    expect(iterator.next().value).toBe("--- Sheet: Visible ---\n");
    const result = await readFixture(bytes, "wide.xlsx", { limit: 1 });
    expect(result.details).toMatchObject({
      kind: "truncated",
      content: "--- Sheet: Visible ---",
      continuation: { kind: "line", offset: 2, limit: 1 },
      truncation: { totalLines: 129, outputLines: 1 },
    });
    const next = await readFixture(bytes, "wide.xlsx", { offset: 2, limit: 1 });
    expect(next.details.kind).toBe("truncated");
    expect(text(next)).toContain("row-1");
    expect(text(next)).not.toContain("row-2");
  });
});
