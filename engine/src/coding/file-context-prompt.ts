// Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c,
// base_coder.py get_files_content/get_read_only_files_content (Apache-2.0).
import { chooseCodeFence, type CodeFence } from "./code-fence.js";

/** Text has already been read by the caller's authorized source loader. */
export type CodingContextFile = {
  path: string;
  content: string | null;
  isImage?: boolean;
};

/** One selected fence is shared by editable and read-only prompt blocks. */
export function buildCodingFileContext(params: {
  editable: readonly CodingContextFile[];
  readOnly?: readonly CodingContextFile[];
  warn?: (message: string) => void;
}): { fence: CodeFence; editable: string; readOnly: string } {
  const readOnly = params.readOnly ?? [];
  const fence = chooseCodeFence(
    [...params.editable, ...readOnly].flatMap((file) =>
      file.content === null ? [] : [file.content],
    ),
    params.warn,
  );
  const format = (files: readonly CodingContextFile[]) =>
    files
      .filter((file) => file.content !== null && !file.isImage)
      .map((file) => `\n${file.path}\n${fence[0]}\n${file.content}${fence[1]}\n`)
      .join("");
  return { fence, editable: format(params.editable), readOnly: format(readOnly) };
}
