// Ported from Aider-AI/aider@5dc9490bb35f9729ef2c95d00a19ccd30c26339c,
// aider/coders/base_coder.py: all_fences and Coder.choose_fence (Apache-2.0).
export type CodeFence = readonly [open: string, close: string];
export const CODE_FENCES: readonly CodeFence[] = [
  ["```", "```"],
  ["````", "````"],
  ["<source>", "</source>"],
  ["<code>", "</code>"],
  ["<pre>", "</pre>"],
  ["<codeblock>", "</codeblock>"],
  ["<sourcecode>", "</sourcecode>"],
];

/** Retains Python splitlines boundaries and source line-start collision semantics. */
export function chooseCodeFence(
  contents: Iterable<string>,
  warn?: (message: string) => void,
): CodeFence {
  const lines = Array.from(contents, (content) => content + "\n")
    .join("")
    .split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  for (const fence of CODE_FENCES) {
    if (!lines.some((line) => line.startsWith(fence[0]) || line.startsWith(fence[1]))) {
      return fence;
    }
  }
  const fallback: CodeFence = ["```", "```"];
  warn?.(`Unable to find a fencing strategy! Falling back to: ${fallback[0]}...${fallback[1]}`);
  return fallback;
}
