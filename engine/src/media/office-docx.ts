// Adapted from Kilo-Org/kilocode 6fd9b7b: packages/opencode/src/kilocode/tool/read-docx.ts.
import mammoth from "mammoth";

export async function extractDocxText(filePath: string, buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract text from DOCX file: ${filePath}\n${message}`, {
      cause: error,
    });
  });
  const warnings = result.messages
    .filter((item) => item.type === "warning")
    .map((item) => item.message);
  return (
    result.value + (warnings.length ? `\n\n(DOCX extraction warnings: ${warnings.join("; ")})` : "")
  );
}
