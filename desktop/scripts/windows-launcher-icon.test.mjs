import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { launcherIconGroups, withWindowsIcon } from "./windows-launcher-icon.mjs";

// Needs the desktop's dev dependencies (resedit), so it runs only in desktop-checks, never in a job without them.
test("the launcher icon stamp gives an icon-less exe the app's icon group, every image unchanged, once", () => {
  const icon = readFileSync(join(import.meta.dirname, "..", "assets", "branch.ico"));
  const ico = Data.IconFile.from(icon);
  // Every image in branch.ico is PNG-compressed: why the .NET Framework csc cannot take it with /win32icon.
  assert.ok(ico.icons.length > 0 && ico.icons.every(item => !item.data.isIcon()), "branch.ico holds only PNG images");
  const stamped = withWindowsIcon(Buffer.from(NtExecutable.createEmpty(false, false).generate()), icon);
  const entries = NtExecutableResource.from(NtExecutable.from(stamped)).entries;
  const groups = Resource.IconGroupEntry.fromEntries(entries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].icons.map(item => [item.width, item.height]), ico.icons.map(item => [item.width, item.height]));
  assert.deepEqual(entries.filter(entry => entry.type === 3).map(entry => Buffer.from(entry.bin)), ico.icons.map(item => Buffer.from(item.data.bin)));
  assert.equal(launcherIconGroups(withWindowsIcon(stamped, icon)), 1, "stamping again replaces the group");
});

test("only the release build loads the icon stamp, and only lazily", () => {
  const build = readFileSync(join(import.meta.dirname, "release-build.mjs"), "utf8");
  assert.doesNotMatch(build, /^import .*windows-launcher-icon/m);
  assert.match(build, /await import\("\.\/windows-launcher-icon\.mjs"\)/);
  for (const file of ["release-installers.mjs", "windows-launcher.mjs", "release-installers.test.mjs"]) {
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, file), "utf8"), /^import .*(resedit|windows-launcher-icon)/m, file);
  }
});
