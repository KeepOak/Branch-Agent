/**
 * @jest-environment node
 */
// Build and test tooling the app pulls in through overrides (package.json "overrides"): the Xcode project writer
// runs on uuid 11 instead of the vulnerable 7, and the coverage config loader reads YAML through js-yaml 4, so
// argparse 1 and sprintf-js leave the tree. Both must keep working as their callers use them.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fromXcode = (name: string) => require.resolve(name, { paths: [require.resolve("xcode")] });

it("writes Xcode object ids with uuid 11.1.1, 24 upper-case hex digits and unique", () => {
  expect(require(join(fromXcode("uuid").split("/dist/")[0], "package.json")).version).toBe("11.1.1");
  const { project: Project } = require("xcode");
  const proj = new Project("unused.pbxproj");
  proj.hash = { project: { objects: {} } };
  const ids = new Set(Array.from({ length: 50 }, () => proj.generateUuid()));
  expect(ids.size).toBe(50);
  for (const id of ids) expect(id).toMatch(/^[0-9A-F]{24}$/);
});

it("reads a YAML coverage config with js-yaml 4, and sprintf-js is gone", async () => {
  expect(require(join(fromJsYaml(), "package.json")).version).toBe("4.3.2");
  expect(() => require.resolve("sprintf-js")).toThrow();
  const dir = mkdtempSync(join(tmpdir(), "nycrc-"));
  try {
    writeFileSync(join(dir, ".nycrc.yaml"), "reporter:\n  - text\nall: true\n");
    const { loadNycConfig } = require("@istanbuljs/load-nyc-config");
    const config = await loadNycConfig({ cwd: dir });
    expect(config.reporter).toEqual(["text"]);
    expect(config.all).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fromJsYaml(): string {
  const main = require.resolve("js-yaml", { paths: [require.resolve("@istanbuljs/load-nyc-config")] });
  return main.slice(0, main.lastIndexOf("node_modules/js-yaml") + "node_modules/js-yaml".length);
}
