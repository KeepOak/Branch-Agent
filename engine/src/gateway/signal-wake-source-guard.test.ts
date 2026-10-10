import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This file lives in engine/src/gateway, so ".." is engine/src.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const SIGNAL_SOURCE = /source\s*:\s*["']signal["']/;
const REQUEST_DERIVED_SOURCE = /source\s*:\s*(params|req|request|payload|body|input|args)\b/;
const DISPATCH_FILE = path.join("infra", "signal-wakes", "signal-wake-dispatch.ts");

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return productionSourceFiles(full);
    }
    const isProduction = entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts");
    return isProduction ? [full] : [];
  });
}

/** The lines that set the source of each wake call in a file, from the call through its object literal. */
function wakeCallWindows(text: string): string[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) =>
    /requestHeartbeat(?:AndWait)?\(/.test(line) ? [lines.slice(index, index + 8).join("\n")] : [],
  );
}

describe("signal wake source guard", () => {
  it("no gateway wake call sets source signal or takes its source from a request field", () => {
    const offenders = productionSourceFiles(path.join(SRC, "gateway"))
      .filter((file) =>
        wakeCallWindows(readFileSync(file, "utf8")).some(
          (window) => SIGNAL_SOURCE.test(window) || REQUEST_DERIVED_SOURCE.test(window),
        ),
      )
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("only the internal signal dispatch path sets source signal anywhere in the engine", () => {
    const setters = productionSourceFiles(SRC)
      .filter((file) => SIGNAL_SOURCE.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));
    expect(setters).toEqual([DISPATCH_FILE]);
  });
});
