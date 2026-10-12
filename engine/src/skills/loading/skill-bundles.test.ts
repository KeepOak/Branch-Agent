import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSkillBundle,
  getSkillBundles,
  listSkillBundles,
  reloadSkillBundles,
  scanSkillBundles,
  slugifySkillBundleName,
} from "./skill-bundles.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-yaml-bundles-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function yaml(file: string, body: string) {
  fs.writeFileSync(path.join(root, file), body);
}
function advance(file: string, seconds = 100) {
  const stamp = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(file, stamp, stamp);
}

describe("source-backed YAML bundle discovery", () => {
  it("keeps complete Unicode source slugs and normalized lookup", () => {
    const name = `小说拆条 ${"backend_".repeat(9)}dev!!!`;
    expect(slugifySkillBundleName(name)).toBe(`小说拆条-${"backend-".repeat(9)}dev`);
    expect(slugifySkillBundleName("!!!")).toBe("");
    yaml("bundle.yaml", `name: ${name}\nskills: [alpha]\n`);
    expect(getSkillBundle(name.replaceAll(" ", "_"), root)?.name).toBe(name);
  });
  it("supports BOM, filename fallback, default description and literal instructions", () => {
    yaml("fallback.yaml", '\uFEFFskills: [alpha, beta]\ninstruction: "literal $ARGUMENTS"\n');
    const bundle = getSkillBundle("fallback", root);
    expect(bundle).toMatchObject({
      name: "fallback",
      description: "Load 2 skills as a bundle",
      skills: ["alpha", "beta"],
      instruction: "literal $ARGUMENTS",
    });
    expect(Object.isFrozen(bundle?.skills)).toBe(true);
  });
  it("scans yaml before yml and keeps the first duplicate slug", () => {
    yaml("z.yaml", "name: combo\nskills: [first]\n");
    yaml("a.yml", "name: combo\nskills: [second]\n");
    yaml("b.yaml", "name: zebra\nskills: [z]\n");
    yaml("a.yaml", "name: apple\nskills: [a]\n");
    expect(getSkillBundle("combo", root)?.skills).toEqual(["first"]);
    expect(listSkillBundles(root).map((bundle) => bundle.slug)).toEqual([
      "apple",
      "combo",
      "zebra",
    ]);
  });
  it.each([
    "",
    "[]",
    "text",
    "skills: []",
    "skills: no",
    "skills: ['  ']",
    "name: '!!!'\nskills: [a]",
    "{broken: yaml: [",
  ])("isolates unusable YAML: %s", (body) => {
    yaml("bad.yaml", body);
    yaml("good.yaml", "skills: [alpha]\n");
    expect([...scanSkillBundles(root).keys()]).toEqual(["/good"]);
  });
  it("isolates read errors without discarding usable files", () => {
    fs.mkdirSync(path.join(root, "bad.yaml"));
    yaml("good.yaml", "skills: [a]");
    expect([...scanSkillBundles(root).keys()]).toEqual(["/good"]);
  });
  it("returns no aliases or writes for a missing root and unknown names", () => {
    const absent = path.join(root, "absent");
    expect(getSkillBundles(absent).size).toBe(0);
    expect(fs.existsSync(absent)).toBe(false);
    expect(getSkillBundle("missing", root)).toBeUndefined();
    expect(getSkillBundle("", root)).toBeUndefined();
  });
  it("observes external additions, overwrites and deletion through source mtime signatures", () => {
    yaml("old.yaml", "skills: [a]");
    scanSkillBundles(root);
    yaml("old.yaml", "skills: [b]");
    advance(path.join(root, "old.yaml"));
    expect(getSkillBundle("old", root)?.skills).toEqual(["b"]);
    yaml("new.yaml", "skills: [n]");
    advance(root, 200);
    expect(getSkillBundles(root).size).toBe(2);
    fs.unlinkSync(path.join(root, "old.yaml"));
    advance(root, 300);
    expect(getSkillBundle("old", root)).toBeUndefined();
  });
  it("reports real reload differences and preserves profile isolation", () => {
    yaml("old.yaml", "skills: [a]");
    scanSkillBundles(root);
    fs.unlinkSync(path.join(root, "old.yaml"));
    yaml("new.yaml", "skills: [b]");
    const diff = reloadSkillBundles(root);
    expect(diff.added.map((bundle) => bundle.name)).toEqual(["new"]);
    expect(diff.removed.map((bundle) => bundle.name)).toEqual(["old"]);
    expect(diff).toMatchObject({ total: 1, unchanged: [] });
    const other = path.join(root, "other");
    fs.mkdirSync(other);
    expect(getSkillBundles(other).size).toBe(0);
    expect(getSkillBundles(root).size).toBe(1);
  });
});
