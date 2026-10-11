---
name: office-artifacts
description: Create Word documents (.docx) and Excel spreadsheets (.xlsx) and deliver them as downloadable file attachments. Use for new Office artifacts, not editing existing files or creating slides.
metadata: { "branch": { "emoji": "📄", "requires": { "bins": ["node"] } } }
---

# Office artifacts

Generate real Office files with the bundled helper and deliver the files, not just their paths.

1. Write a UTF-8 JSON input file in the session workspace using the schemas below.
2. Run the helper with absolute input and output paths. Resolve `{baseDir}` to this skill's directory:

   ```sh
   node {baseDir}/scripts/generate.mjs docx /absolute/input.json /absolute/report.docx
   node {baseDir}/scripts/generate.mjs xlsx /absolute/input.json /absolute/budget.xlsx
   ```

3. The command prints JSON with `path`, `format`, and `bytes`. It refuses existing output files; choose a new filename when revising.
4. Reopen the output with the Office-capable read tool (or an installed Office reader) and verify the requested content. Do not call a successful write an open/render check.
5. Deliver using `message(action="send", media=<absolute output path>, filename=<friendly name>)` to the requesting conversation. For multiple files, use `attachments` with `type="file"`, `media`, and `name` for each. An explicit delivery request authorizes sending to that requester, not to other people. Check the tool result before claiming delivery; if delivery fails, report the failure and retain the local file.

## DOCX input

```json
{
  "title": "Project update",
  "paragraphs": ["First paragraph.", "Next paragraph with a line break.\nSecond line."]
}
```

`title` is optional. `paragraphs` is an array of strings. Unicode, XML punctuation, tabs and line breaks are preserved. The helper creates a simple title and paragraphs, not rich layouts, tables, embedded media or tracked changes.

## XLSX input

```json
{
  "sheets": [
    { "name": "Budget", "rows": [["Item", "Amount", "Approved"], ["Supplies", 42.5, true]] },
    { "name": "Notes", "rows": [["Prepared for review"]] }
  ]
}
```

Cells are strings, finite numbers, booleans, or null (blank). Formula-like strings stay text; formulas, charts and styles are not supported by this helper. Sheet names must be valid Excel names and unique without regard to case. The helper uses Branch's bundled JSZip and SheetJS dependencies; do not install packages globally or require cloud credentials.
