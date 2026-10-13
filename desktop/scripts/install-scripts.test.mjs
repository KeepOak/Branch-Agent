// Runs desktop/install/install.sh against a local fixture release (file:// URLs) with HOME in a temp folder.
// BRANCH_INSTALL_BASE_URL is the test-only switch that points the script at the fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../install/install.sh", import.meta.url));
const target = `${process.platform}-${process.arch}`;
const supported = target === "darwin-arm64" || target === "linux-x64";
const skip = supported ? false : `install.sh installs on darwin-arm64 and linux-x64; this host is ${target}`;

function sha256(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

/** A fake desktop package for this host, as the release publishes it. */
function makeAsset(root, version) {
  const stage = mkdtempSync(join(root, "stage-"));
  if (process.platform === "darwin") {
    mkdirSync(join(stage, "Branch Agent.app", "Contents"), { recursive: true });
    writeFileSync(join(stage, "Branch Agent.app", "Contents", "VERSION"), version);
  } else {
    writeFileSync(join(stage, "branch-agent"), "#!/bin/sh\necho branch\n");
    chmodSync(join(stage, "branch-agent"), 0o755);
    writeFileSync(join(stage, "VERSION"), version);
  }
  const name = `branch-desktop-${version}-${target}.tar.gz`;
  const file = join(root, name);
  const tar = spawnSync("tar", ["-czf", file, "-C", stage, "."], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  rmSync(stage, { recursive: true });
  return { name, file };
}

/** releases/download/v<version>/ for each version, and releases/latest/download/ for the last one. */
function makeRelease(root, versions) {
  const releases = join(root, "releases");
  for (const version of versions) {
    const dir = join(releases, "download", `v${version}`);
    mkdirSync(dir, { recursive: true });
    const asset = makeAsset(root, version);
    cpSync(asset.file, join(dir, asset.name));
    // Neighbouring assets, including the desktop-app component whose name shares the prefix.
    writeFileSync(join(dir, `branch-desktop-app-${version}-${target}.tar.gz`), "component");
    writeFileSync(join(dir, `branch-release-${target}.json`), "{}");
    const sums = readdirSync(dir).sort().map(name => `${sha256(join(dir, name))}  ${name}`).join("\n") + "\n";
    writeFileSync(join(dir, "SHA256SUMS"), sums);
  }
  mkdirSync(join(releases, "latest"), { recursive: true });
  cpSync(join(releases, "download", `v${versions.at(-1)}`), join(releases, "latest", "download"), { recursive: true });
  return releases;
}

function fixture(versions = ["1.0.0", "1.2.3"]) {
  const root = mkdtempSync(join(tmpdir(), "branch-install-test-"));
  const home = join(root, "home"), temp = join(root, "tmp");
  mkdirSync(home); mkdirSync(temp);
  const releases = makeRelease(root, versions);
  const run = (...args) => spawnSync("sh", [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: temp, BRANCH_INSTALL_BASE_URL: pathToFileURL(releases).href },
  });
  const installRoot = process.platform === "darwin" ? join(home, "Applications", "Branch Agent.app") : join(home, ".local", "share", "branch-agent");
  const installed = () => {
    const file = process.platform === "darwin" ? join(installRoot, "Contents", "VERSION") : join(installRoot, "VERSION");
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const leftovers = () => {
    const parent = join(installRoot, "..");
    return existsSync(parent) ? readdirSync(parent).filter(name => name.includes("install")) : [];
  };
  return { root, home, temp, releases, run, installRoot, installed, leftovers, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a verified latest release installs per user, and a re-run replaces it cleanly", { skip }, () => {
  const f = fixture();
  try {
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Verified SHA-256 [0-9a-f]{64}/);
    assert.match(first.stdout, /Next: /);
    assert.equal(f.installed(), "1.2.3");
    if (process.platform === "linux") {
      const launcher = join(f.home, ".local", "bin", "branch-agent");
      assert.match(readFileSync(launcher, "utf8"), /branch-agent\/branch-agent/);
      assert.match(readFileSync(join(f.home, ".local", "share", "applications", "branch-agent.desktop"), "utf8"), /^Exec=.*branch-agent/m);
    }
    writeFileSync(join(f.installRoot, "stale-file"), "from the old install");
    const second = f.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(f.installed(), "1.2.3");
    assert(!existsSync(join(f.installRoot, "stale-file")), "the re-run must replace the install, not merge into it");
    assert.deepEqual(f.leftovers(), []);
    assert.deepEqual(readdirSync(f.temp), [], "temporary downloads are removed");
  } finally { f.cleanup(); }
});

test("a tampered asset fails the SHA-256 check and installs nothing", { skip }, () => {
  const f = fixture();
  try {
    const dir = join(f.releases, "latest", "download");
    const asset = readdirSync(dir).find(name => /^branch-desktop-\d.*\.tar\.gz$/.test(name));
    writeFileSync(join(dir, asset), Buffer.concat([readFileSync(join(dir, asset)), Buffer.from("tampered")]));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.match(result.stderr, /Nothing was installed/);
    assert.equal(existsSync(f.installRoot), false);
    assert.equal(existsSync(join(f.home, ".local", "bin", "branch-agent")), false);
    assert.deepEqual(f.leftovers(), []);
  } finally { f.cleanup(); }
});

test("a tampered upgrade leaves the existing install untouched", { skip }, () => {
  const f = fixture();
  try {
    assert.equal(f.run("--version", "v1.0.0").status, 0);
    const dir = join(f.releases, "latest", "download");
    const asset = readdirSync(dir).find(name => /^branch-desktop-\d.*\.tar\.gz$/.test(name));
    writeFileSync(join(dir, asset), "not the published bytes");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(f.installed(), "1.0.0");
  } finally { f.cleanup(); }
});

test("SHA256SUMS without an entry for the asset fails and installs nothing", { skip }, () => {
  const f = fixture();
  try {
    const sums = join(f.releases, "latest", "download", "SHA256SUMS");
    writeFileSync(sums, readFileSync(sums, "utf8").split("\n").filter(line => !/  branch-desktop-\d/.test(line)).join("\n"));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no single entry/);
    assert.equal(existsSync(f.installRoot), false);
  } finally { f.cleanup(); }
});

test("--version selects that release's tag", { skip }, () => {
  const f = fixture();
  try {
    const result = f.run("--version", "v1.0.0");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release v1\.0\.0/);
    assert.equal(f.installed(), "1.0.0");
    const bare = f.run("--version=1.2.3");
    assert.equal(bare.status, 0, bare.stderr);
    assert.equal(f.installed(), "1.2.3");
    const missing = f.run("--version", "v9.9.9");
    assert.notEqual(missing.status, 0);
    assert.equal(f.installed(), "1.2.3");
  } finally { f.cleanup(); }
});

test("install.sh never uses sudo and passes shellcheck when it is installed", { skip: process.platform === "win32" }, () => {
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source.replace(/^\s*#.*$/gm, "").replace(/needs no sudo/g, ""), /\bsudo\b/);
  const ps1 = readFileSync(fileURLToPath(new URL("../install/install.ps1", import.meta.url)), "utf8");
  assert.match(ps1, /Get-FileHash/);
  assert.match(ps1, /\/CURRENTUSER/);
  assert.doesNotMatch(ps1, /RunAs/);
  const check = spawnSync("shellcheck", ["-s", "sh", script], { encoding: "utf8" });
  if (check.error?.code === "ENOENT") return;
  assert.equal(check.status, 0, check.stdout + check.stderr);
});
