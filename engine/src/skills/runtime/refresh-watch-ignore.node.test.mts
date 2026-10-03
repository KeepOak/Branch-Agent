import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
const source = process.env.BRANCH_WATCH_IGNORE_BASELINE ?? new URL("./refresh-watch-path.ts", import.meta.url).href;
const { DEFAULT_SKILLS_WATCH_IGNORED, isIgnoredSkillsWatchPath, isSkillDiscoveryFileWatchPath } = await import(source);
const directories = [".git", "node_modules", "dist", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", "build", ".cache"];
for (const directory of directories) {
  test(`shared traversal and notification exclusions agree for ${directory}`, () => {
    const variants = [directory, directory.toUpperCase()];
    for (const variant of variants) {
      const candidate = `skills/${variant}/nested/SKILL.md`;
      const expected = variant === directory || process.platform === "win32";
      assert.equal(isIgnoredSkillsWatchPath(candidate), expected);
      assert.equal(DEFAULT_SKILLS_WATCH_IGNORED.some((pattern: RegExp) => pattern.test(candidate)), expected);
      assert.equal(isSkillDiscoveryFileWatchPath(candidate), !expected);
      assert.equal(isIgnoredSkillsWatchPath(candidate.replaceAll("/", "\\")), expected);
    }
  });
}
test("directory boundaries retain similarly named real skills", () => {
  for (const name of ["node_modules_notes", "rebuild", "distillery", "venv-guide", ".git-guide"]) {
    assert.equal(isIgnoredSkillsWatchPath(`skills/${name}/SKILL.md`), false);
    assert.equal(isSkillDiscoveryFileWatchPath(`skills/${name}/SKILL.md`), true);
  }
});
test("native Windows dependency directory casing denotes the same files", {skip:process.platform !== "win32"}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-watch-ignore-"));
  try {
    const directory = path.join(root, "Node_Modules", "helper");
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory, "SKILL.md"), "dependency instructions");
    const alternate = path.join(root, "node_modules", "helper", "SKILL.md");
    assert.equal(fs.readFileSync(alternate, "utf8"), "dependency instructions");
    assert.equal(isIgnoredSkillsWatchPath(path.relative(root, path.join(directory,"SKILL.md"))),true);
    assert.equal(isSkillDiscoveryFileWatchPath(path.join(directory,"SKILL.md")),false);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});
