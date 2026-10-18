import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pairingConfirmCode } from "./pairing-confirm-code";

describe("pairingConfirmCode", () => {
  it("matches the engine's six-character confirm code", () => {
    const engine = readFileSync(
      join(import.meta.dirname, "../../../engine/src/pairing/confirm-code.ts"),
      "utf8",
    );
    const windowSource = readFileSync(join(import.meta.dirname, "pairing-confirm-code.ts"), "utf8");
    const engineFn = engine.slice(engine.indexOf("export function pairingConfirmCode"));
    const windowFn = windowSource.slice(windowSource.indexOf("export function pairingConfirmCode"));
    expect(windowFn).toBe(engineFn);
    expect(pairingConfirmCode("setup-123")).toBe("F2S4KP");
    expect(pairingConfirmCode("s1")).toBe("9M36D8");
  });
});
