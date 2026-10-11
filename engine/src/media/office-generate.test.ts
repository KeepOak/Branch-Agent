import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import mammoth from "mammoth";
import { afterEach, describe, expect, it } from "vitest";
import { read } from "xlsx";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { extractOfficeContent } from "./office-extract.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const run = promisify(execFile);
const script = path.resolve("skills/office-artifacts/scripts/generate.mjs");

async function generate(format: string, input: unknown) {
  const dir = tempDirs.make("office-generate-");
  const source = path.join(dir, "input.json");
  const output = path.join(dir, `result.${format}`);
  await fs.writeFile(source, JSON.stringify(input));
  const result = await run(process.execPath, [script, format, source, output], {
    windowsHide: true,
  });
  return { source, output, result, bytes: await fs.readFile(output) };
}

describe("Office artifact generation CLI", () => {
  it("writes a DOCX that opens in the production Office reader", async () => {
    const { bytes, output, result } = await generate("docx", {
      title: "Quarterly report",
      paragraphs: [
        "Revenue & costs <forecast>",
        "Unicode: café 日本語 😀",
        "Line one\nLine two\ttab",
      ],
    });
    expect(JSON.parse(result.stdout).path).toBe(output);
    const content = await extractOfficeContent(output, bytes);
    expect(content?.kind).toBe("text");
    if (content?.kind !== "text") {
      throw new Error("Expected DOCX text");
    }
    expect(content.text).toContain("Quarterly report");
    expect(content.text).toContain("Revenue & costs <forecast>");
    expect(content.text).toContain("Unicode: café 日本語 😀");
    // Raw text extraction omits soft breaks; the HTML reader preserves their layout.
    expect(content.text).toContain("Line oneLine two\ttab");
    expect((await mammoth.convertToHtml({ buffer: bytes })).value).toContain(
      "Line one<br />Line two",
    );
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(await zip.file("_rels/.rels")?.async("string")).toContain('Target="word/document.xml"');
  });

  it("writes an XLSX that preserves typed cells, sheets and formula-like text", async () => {
    const { bytes, output } = await generate("xlsx", {
      sheets: [
        {
          name: "Budget",
          rows: [
            ["Item", "Amount", "Approved"],
            ["Supplies", 42.5, true],
            ["=1+1", null, false],
          ],
        },
        { name: "Notes", rows: [["café & 日本語"]] },
      ],
    });
    const book = read(bytes, { type: "buffer" });
    expect(book.SheetNames).toEqual(["Budget", "Notes"]);
    expect(book.Sheets.Budget.B2.v).toBe(42.5);
    expect(book.Sheets.Budget.C2.v).toBe(true);
    expect(book.Sheets.Budget.A3).toMatchObject({ t: "s", v: "=1+1" });
    expect(book.Sheets.Budget.A3.f).toBeUndefined();
    const content = await extractOfficeContent(output, bytes);
    if (content?.kind !== "stream") {
      throw new Error("Expected spreadsheet text");
    }
    expect([...content.chunks].join("")).toContain("café & 日本語");
  });

  it("refuses to overwrite an existing artifact", async () => {
    const { source, output, bytes } = await generate("docx", { paragraphs: ["Keep me"] });
    await expect(
      run(process.execPath, [script, "docx", source, output], { windowsHide: true }),
    ).rejects.toThrow();
    expect(await fs.readFile(output)).toEqual(bytes);
  });

  it.each([
    ["docx", { paragraphs: ["Invalid\u0000XML"] }],
    ["xlsx", { sheets: [{ name: "Data", rows: [[{ formula: "1+1" }]] }] }],
    [
      "xlsx",
      {
        sheets: [
          { name: "Data", rows: [] },
          { name: "data", rows: [] },
        ],
      },
    ],
    ["pptx", {}],
  ])("rejects invalid %s input without creating an artifact", async (format, input) => {
    const dir = tempDirs.make("office-invalid-");
    const source = path.join(dir, "input.json");
    const output = path.join(dir, `result.${format}`);
    await fs.writeFile(source, JSON.stringify(input));
    await expect(
      run(process.execPath, [script, format as string, source, output], { windowsHide: true }),
    ).rejects.toThrow();
    await expect(fs.access(output)).rejects.toThrow();
  });
});
