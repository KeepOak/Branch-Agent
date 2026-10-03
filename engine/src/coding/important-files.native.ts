// Source tests/basic/test_special.py assertions, translated to native node:test.
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { isImportantFile, filterImportantFiles } from "./important-files.js";
test("source common important files and workflow matches", () => {
  for (const file of ["README.md", ".gitignore", "requirements.txt", "setup.py", path.join(".github", "workflows", "test.yml"), path.join(".github", "workflows", "deploy.yml")]) assert.equal(isImportantFile(file), true);
  for (const file of ["random_file.txt", "src/main.py", "tests/test_app.py"]) assert.equal(isImportantFile(file), false);
});
test("source filter preserves important paths", () => {
  const files = ["README.md", "src/main.py", ".gitignore", "tests/test_app.py", "requirements.txt", ".github/workflows/test.yml", "random_file.txt"];
  assert.deepEqual(new Set(filterImportantFiles(files)), new Set(["README.md", ".gitignore", "requirements.txt", ".github/workflows/test.yml"]));
});
test("source case sensitivity", () => {
  assert.equal(isImportantFile("README.md"), true);
  assert.equal(isImportantFile("readme.md"), false);
  assert.equal(isImportantFile(".gitignore"), true);
  assert.equal(isImportantFile(".GITIGNORE"), false);
});
test("source path formats distinguish repo root from nested and absolute files", () => {
  assert.equal(isImportantFile("project/README.md"), false);
  assert.equal(isImportantFile("./README.md"), true);
  assert.equal(isImportantFile("/absolute/path/to/README.md"), false);
});
for (const file of ["README", "README.txt", "README.rst", "LICENSE", "LICENSE.md", "LICENSE.txt", "Dockerfile", "package.json", "pyproject.toml"]) {
  test(`source various files: ${file}`, () => assert.equal(isImportantFile(file), true));
}
test("workflow extension and directory rules match source", () => {
  assert.equal(isImportantFile(".github/workflows/test.yaml"), false);
  assert.equal(isImportantFile(".github/workflows/nested/test.yml"), false);
  assert.equal(isImportantFile("project/.github/workflows/test.yml"), false);
});
test("filter retains source order and duplicates without changing caller array", () => {
  const files = ["package.json", "src/a.ts", "README.md", "package.json"];
  assert.deepEqual(filterImportantFiles(files), ["package.json", "README.md", "package.json"]);
  assert.equal(files.length, 4);
});
