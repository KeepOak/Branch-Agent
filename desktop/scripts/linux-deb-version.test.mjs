import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { debVersion } from "./linux-deb.mjs";

// The .deb control Version must let dpkg and apt order two builds of one base version.
const OLD = "0.4.4-build-56aed4e6d99d";
const older = debVersion(OLD, { GITHUB_RUN_NUMBER: "811" });
const newer = debVersion("0.4.4-build-0123456789ab", { GITHUB_RUN_NUMBER: "812" });
const bumped = debVersion("0.4.5-build-56aed4e6d99d", { GITHUB_RUN_NUMBER: "9" });

const dpkg = spawnSync("dpkg", ["--version"], { encoding: "utf8" });
const noDpkg = dpkg.error || dpkg.status !== 0 ? "dpkg is not installed, so dpkg --compare-versions cannot run" : false;
const greater = (a, b) => spawnSync("dpkg", ["--compare-versions", a, "gt", b]).status === 0;

test("the deb version is <base>.<run>+<sha12> from GITHUB_RUN_NUMBER and the build sha", () => {
  assert.equal(older, "0.4.4.811+56aed4e6d99d");
  assert.equal(newer, "0.4.4.812+0123456789ab");
  assert.equal(bumped, "0.4.5.9+56aed4e6d99d");
  assert.equal(debVersion("0.4.4", { GITHUB_RUN_NUMBER: "7", GITHUB_SHA: "abcdef0123456789abcdef0123456789abcdef01" }), "0.4.4.7+abcdef012345");
});

test("without a run number or sha the deb version falls back to <base>.0", () => {
  assert.equal(debVersion(OLD, {}), "0.4.4.0+56aed4e6d99d");
  assert.equal(debVersion("0.4.4", {}), "0.4.4.0");
  assert.throws(() => debVersion("latest", {}), /Not a Debian package version/);
  assert.throws(() => debVersion("0.4.4", { GITHUB_RUN_NUMBER: "12a" }), /Not a run number/);
});

test("dpkg: a newer run beats an older run of the same base", { skip: noDpkg }, () => {
  assert.ok(greater(newer, older), `${newer} should sort above ${older}`);
  assert.ok(!greater(older, newer));
});

test("dpkg: the new form beats an old 0.4.4-build-<sha> version", { skip: noDpkg }, () => {
  assert.ok(greater(older, OLD), `${older} should sort above ${OLD}`);
  assert.ok(greater(newer, OLD));
  assert.ok(greater(debVersion("0.4.4", {}), "0.4.4-build-ffffffffffff"), "even the run 0 fallback sorts above the old form");
});

test("dpkg: a base bump beats both older forms", { skip: noDpkg }, () => {
  assert.ok(greater(bumped, newer), `${bumped} should sort above ${newer}`);
  assert.ok(greater(bumped, OLD), `${bumped} should sort above ${OLD}`);
});
