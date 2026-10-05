import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../src");

test("desktop child-process launches are hidden", () => {
  for (const file of ["gateway.ts", "desktop-update.ts", "desktop-update-helper.ts", "desktop-os.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /windowsHide\s*:\s*false/, file);
    assert.match(source, /windowsHide\s*:\s*true/, file);
  }
  assert.match(readFileSync(join(root, "gateway.ts"), "utf8"), /execFileSync\("taskkill"[^\n]*windowsHide: true/);
  assert.match(readFileSync(join(root, "desktop-update-helper.ts"), "utf8"), /execFileSync\("taskkill"[^\n]*windowsHide: true/);
});
