#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { utils, write } from "xlsx";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function text(value) {
  if (typeof value !== "string") throw new Error("Expected a string");
  for (const character of value) {
    const cp = character.codePointAt(0);
    if (
      !(
        cp === 9 ||
        cp === 10 ||
        cp === 13 ||
        (cp >= 32 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) ||
        cp >= 0x10000
      )
    ) {
      throw new Error("Text contains a character not allowed in XML");
    }
  }
  return value;
}

function xml(value) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function paragraph(value, title = false) {
  const runs = text(value)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/([\n\t])/u)
    .map((part) =>
      part === "\n"
        ? "<w:br/>"
        : part === "\t"
          ? "<w:tab/>"
          : `<w:t xml:space="preserve">${xml(part)}</w:t>`,
    )
    .join("");
  return `<w:p><w:r>${title ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : ""}${runs}</w:r></w:p>`;
}

async function docx(input) {
  if (!Array.isArray(input.paragraphs)) throw new Error("DOCX requires paragraphs: string[]");
  const body =
    (input.title === undefined ? "" : paragraph(input.title, true)) +
    input.paragraphs.map((value) => paragraph(value)).join("");
  // Same minimal OPC package as the production Office reader's DOCX fixtures.
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    xmlHeader +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    xmlHeader +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    xmlHeader +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function xlsx(input) {
  if (!Array.isArray(input.sheets) || input.sheets.length === 0) {
    throw new Error("XLSX requires at least one sheet with name and rows");
  }
  const book = utils.book_new();
  const names = new Set();
  for (const sheet of input.sheets) {
    const name = text(sheet.name);
    if (
      !name ||
      name.length > 31 ||
      /[\\/?*\[\]:]/u.test(name) ||
      name.startsWith("'") ||
      name.endsWith("'")
    ) {
      throw new Error("Invalid Excel sheet name");
    }
    if (names.has(name.toLowerCase()))
      throw new Error("Sheet names must be unique (case-insensitive)");
    names.add(name.toLowerCase());
    if (!Array.isArray(sheet.rows) || sheet.rows.length > 1048576)
      throw new Error("Invalid sheet rows");
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length > 16384) throw new Error("Invalid sheet row");
      for (const cell of row) {
        if (typeof cell === "string") text(cell);
        else if (
          cell !== null &&
          typeof cell !== "boolean" &&
          !(typeof cell === "number" && Number.isFinite(cell))
        ) {
          throw new Error("Cells must be strings, finite numbers, booleans or null");
        }
      }
    }
    utils.book_append_sheet(book, utils.aoa_to_sheet(sheet.rows), name);
  }
  return write(book, { type: "buffer", bookType: "xlsx", compression: true });
}

async function main() {
  const [format, source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length || !["docx", "xlsx"].includes(format)) {
    throw new Error("Usage: node generate.mjs docx|xlsx input.json output.docx|output.xlsx");
  }
  if (path.extname(destination).toLowerCase() !== `.${format}`)
    throw new Error("Output extension must match format");
  const input = JSON.parse(await readFile(source, "utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Input must be a JSON object");
  const bytes = format === "docx" ? await docx(input) : xlsx(input);
  await writeFile(destination, bytes, { flag: "wx" });
  console.log(JSON.stringify({ path: path.resolve(destination), format, bytes: bytes.length }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
