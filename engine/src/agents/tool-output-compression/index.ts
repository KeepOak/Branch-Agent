// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/engine.go (atlas AGENT-LOOP-0349): detect, route to the
// matching compressor, and fall back to the original when the result is not smaller.
// This slice registers the log and diff compressors; every other type passes through.

import { detectContentType, type ToolOutputContentType } from "./detect.js";
import { compressDiff } from "./diff.js";
import { utf8Length } from "./line-ends.js";
import { compressLog } from "./log.js";

export { detectContentType, type ToolOutputContentType } from "./detect.js";

type Compressor = (input: string, query: string) => string | undefined;

const COMPRESSORS: Partial<Record<ToolOutputContentType, Compressor>> = {
  log: compressLog,
  diff: (input) => compressDiff(input),
};

export type ToolOutputCompression = { contentType: ToolOutputContentType; text: string };

/** Content-aware compression; undefined when no compressor applies or the output would not shrink. */
export function compressToolOutput(
  text: string,
  options: { query?: string } = {},
): ToolOutputCompression | undefined {
  const contentType = detectContentType(text);
  const compressed = COMPRESSORS[contentType]?.(text, options.query ?? "");
  if (compressed === undefined || utf8Length(compressed) >= utf8Length(text)) {
    return undefined;
  }
  return { contentType, text: compressed };
}
