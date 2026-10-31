// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/lineends.go (atlas AGENT-LOOP-0349). Strings replace Go byte slices.

const encoder = new TextEncoder();

/** UTF-8 byte length, the unit every upstream size threshold is written in. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/** Ill-formed UTF-16 (a lone surrogate) is the string form of upstream's invalid UTF-8 check. */
export function isWellFormedText(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

/** Splits on LF, leaving any CR attached to its own line; trailing reports a final line break. */
export function splitLines(input: string): { lines: string[]; trailing: boolean } {
  const trailing = input.endsWith("\n");
  const body = trailing ? input.slice(0, -1) : input;
  return { lines: body.split("\n"), trailing };
}

/** The inverse of splitLines. */
export function joinLines(lines: string[], trailing: boolean): string {
  const out = lines.join("\n");
  return trailing ? out + "\n" : out;
}

function countOf(input: string, needle: string): number {
  return input.split(needle).length - 1;
}

/** Reports whether most of the line breaks in input are CRLF. */
export function majorityCRLF(input: string): boolean {
  const lf = countOf(input, "\n");
  return lf > 0 && countOf(input, "\r\n") * 2 > lf;
}

/** The CR a synthesized line needs so it matches the document's dominant endings. */
export function crSuffix(input: string): string {
  return majorityCRLF(input) ? "\r" : "";
}

/** Builds a synthesized line (an elision marker) with the document's dominant line ending. */
export function synthLine(text: string, cr: string): string {
  return text + cr;
}
