// Adapted from Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c
// aider/coders/wholefile_coder.py: WholeFileCoder.get_edits (update mode).
export type WholeFileNameSource = "block" | "saw" | "chat";
export interface WholeFileEdit {
  path: string;
  filenameSource: WholeFileNameSource;
  content: string;
}

/** Aider's whole-file format parser. Paths remain proposals for the guarded writer. */
export function parseWholeFileEdits(
  content: string,
  chatFiles: readonly string[],
  fence: readonly [string, string] = ["```", "```"],
): WholeFileEdit[] {
  // Python str.splitlines(keepends=True), including its Unicode line boundaries.
  const lines = content.match(/[^\n\r\v\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])|[^\n\r\v\f\x1c-\x1e\x85\u2028\u2029]+$/g) ?? [];
  const edits: WholeFileEdit[] = [];
  let sawFilename: string | undefined;
  let filename: string | undefined;
  let filenameSource: WholeFileNameSource | undefined;
  let newLines: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith(fence[0]) || line.startsWith(fence[1])) {
      if (filename !== undefined) {
        sawFilename = undefined;
        edits.push({ path: filename, filenameSource: filenameSource!, content: newLines.join("") });
        filename = undefined;
        filenameSource = undefined;
        newLines = [];
        continue;
      }
      if (index > 0) {
        filenameSource = "block";
        filename = lines[index - 1]!.trim().replace(/^\*+|\*+$/g, "")
          .replace(/:+$/g, "").replace(/^`+|`+$/g, "").replace(/^#+/g, "").trim();
        if ([...filename].length > 250) filename = "";
        const basename = filename.split(/[\\/]/).at(-1)!;
        if (filename && !chatFiles.includes(filename) && chatFiles.includes(basename)) filename = basename;
      }
      if (!filename) {
        if (sawFilename) {
          filename = sawFilename;
          filenameSource = "saw";
        } else if (chatFiles.length === 1) {
          filename = chatFiles[0]!;
          filenameSource = "chat";
        } else {
          throw new Error(`No filename provided before ${fence[0]} in file listing`);
        }
      }
    } else if (filename !== undefined) {
      newLines.push(line);
    } else {
      for (const rawWord of line.trim().split(/\s+/)) {
        const word = rawWord.replace(/[.:,;!]+$/g, "");
        for (const chatFile of chatFiles) {
          if (word === `\`${chatFile}\``) sawFilename = chatFile;
        }
      }
    }
  }
  if (filename) edits.push({ path: filename, filenameSource: filenameSource!, content: newLines.join("") });
  const seen = new Set<string>();
  const refined: WholeFileEdit[] = [];
  for (const source of ["block", "saw", "chat"] as const) {
    for (const edit of edits) {
      if (edit.filenameSource !== source || seen.has(edit.path)) continue;
      seen.add(edit.path);
      refined.push(edit);
    }
  }
  return refined;
}
