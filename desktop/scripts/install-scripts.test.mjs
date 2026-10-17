// Runs desktop/install/install.sh against a local fixture release (file:// URLs) with HOME in a temp folder.
// BRANCH_INSTALL_BASE_URL is the test-only switch that points the script at the fixture; BRANCH_INSTALL_TEST_TARGET
// (test-only too) runs the other platform's install path, so both run on any macOS or Linux host.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../install/install.sh", import.meta.url));
const hostTarget = `${process.platform}-${process.arch}`;
const supported = process.platform === "darwin" || process.platform === "linux";
const skip = supported ? false : `install.sh runs on macOS and Linux; this host is ${hostTarget}`;
const RELEASE_DESIGNATED = 'designated => identifier "com.electron.branch-agent" and certificate root = H"30bbf0b68236ae05e063465c39dea6c5b396b11c"';
const TARGETS = ["darwin-arm64", "linux-x64"];

function sha256(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

/** A codesign stand-in on PATH: an app's Contents/SIGNATURE file says "identity", "adhoc", or nothing (unsigned). */
function fakeCodesign(root) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codesign"), `#!/bin/sh
mode=$1
for last; do :; done
kind=$(cat "$last/Contents/SIGNATURE" 2>/dev/null || true)
case $mode in
  -dv) case $kind in adhoc) echo "Signature=adhoc" >&2 ;; identity) echo "Authority=Branch Release" >&2 ;; *) echo "code object is not signed at all" >&2; exit 1 ;; esac ;;
  -dr) case $kind in identity) echo '${RELEASE_DESIGNATED}' ;; adhoc) echo 'designated => cdhash H"00"' ;; *) exit 1 ;; esac ;;
esac
`);
  chmodSync(join(bin, "codesign"), 0o755);
  return bin;
}

/** The asset install.sh installs for a target: the macOS desktop package, or the Linux AppImage. */
const assetName = (version, target) => target.startsWith("darwin") ? `branch-desktop-${version}-${target}.tar.gz` : `Branch-Agent-${version}-${target}.AppImage`;
const isInstallAsset = name => /^branch-desktop-\d.*-darwin-arm64\.tar\.gz$|^Branch-Agent-\d.*-linux-x64\.AppImage$/.test(name);

/** A fake installable asset for the target, as the release publishes it. */
function makeAsset(root, version, target, signing) {
  const name = assetName(version, target);
  const file = join(root, name);
  if (target.startsWith("linux")) {
    // Release downloads carry no exec bit; install.sh sets it.
    writeFileSync(file, `#!/bin/sh\n# Branch Agent AppImage fixture\n# version ${version}\necho branch\n`);
    return { name, file };
  }
  const stage = mkdtempSync(join(root, "stage-"));
  mkdirSync(join(stage, "Branch Agent.app", "Contents"), { recursive: true });
  writeFileSync(join(stage, "Branch Agent.app", "Contents", "VERSION"), version);
  if (signing) writeFileSync(join(stage, "Branch Agent.app", "Contents", "SIGNATURE"), signing);
  const tar = spawnSync("tar", ["-czf", file, "-C", stage, "."], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  rmSync(stage, { recursive: true });
  return { name, file };
}

/** releases/download/v<version>/ for each version, and releases/latest/download/ for the last one. */
function makeRelease(root, versions, target, signing = {}) {
  const releases = join(root, "releases");
  for (const version of versions) {
    const dir = join(releases, "download", `v${version}`);
    mkdirSync(dir, { recursive: true });
    const asset = makeAsset(root, version, target, signing[version]);
    cpSync(asset.file, join(dir, asset.name));
    // Neighbouring assets: the desktop-app component whose name shares the prefix and, on Linux, the bootstrap
    // tar.gz that the desktop updater uses but install.sh must never pick.
    writeFileSync(join(dir, `branch-desktop-app-${version}-${target}.tar.gz`), "component");
    if (target.startsWith("linux")) writeFileSync(join(dir, `branch-desktop-${version}-${target}.tar.gz`), "bootstrap package");
    writeFileSync(join(dir, `branch-release-${target}.json`), "{}");
    const sums = readdirSync(dir).sort().map(name => `${sha256(join(dir, name))}  ${name}`).join("\n") + "\n";
    writeFileSync(join(dir, "SHA256SUMS"), sums);
  }
  mkdirSync(join(releases, "latest"), { recursive: true });
  cpSync(join(releases, "download", `v${versions.at(-1)}`), join(releases, "latest", "download"), { recursive: true });
  return releases;
}

function fixture(versions = ["1.0.0", "1.2.3"], { target = hostTarget, signing } = {}) {
  const root = mkdtempSync(join(tmpdir(), "branch-install-test-"));
  const home = join(root, "home"), temp = join(root, "tmp");
  mkdirSync(home); mkdirSync(temp);
  const bin = fakeCodesign(root);
  const releases = makeRelease(root, versions, target, signing);
  const run = (...args) => spawnSync("sh", [script, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: temp, BRANCH_INSTALL_BASE_URL: pathToFileURL(releases).href,
      ...(target === hostTarget ? {} : { BRANCH_INSTALL_TEST_TARGET: target }) },
  });
  const darwin = target.startsWith("darwin");
  const installRoot = darwin ? join(home, "Applications", "Branch.app") : join(home, ".local", "bin", "branch-agent");
  const desktopEntry = join(home, ".local", "share", "applications", "branch-agent.desktop");
  const installed = () => {
    if (!darwin) return existsSync(installRoot) ? /^# version (.+)$/m.exec(readFileSync(installRoot, "utf8"))?.[1] ?? "unknown" : null;
    const file = join(installRoot, "Contents", "VERSION");
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const leftovers = () => [join(installRoot, ".."), join(desktopEntry, "..")]
    .flatMap(parent => existsSync(parent) ? readdirSync(parent).filter(name => name.includes("install")) : []);
  return { root, home, temp, releases, run, target, darwin, installRoot, desktopEntry, installed, leftovers,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

for (const target of TARGETS) {
  test(`${target}: a verified latest release installs per user, and a re-run replaces it cleanly`, { skip }, () => {
    const f = fixture(undefined, { target });
    try {
      const first = f.run();
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /Verified SHA-256 [0-9a-f]{64}/);
      assert.match(first.stdout, /Next: /);
      assert.equal(f.installed(), "1.2.3");
      if (f.darwin) writeFileSync(join(f.installRoot, "stale-file"), "from the old install");
      else writeFileSync(f.installRoot, "#!/bin/sh\n# version stale\n");
      const second = f.run();
      assert.equal(second.status, 0, second.stderr);
      assert.equal(f.installed(), "1.2.3");
      if (f.darwin) assert(!existsSync(join(f.installRoot, "stale-file")), "the re-run must replace the install, not merge into it");
      assert.deepEqual(f.leftovers(), []);
      assert.deepEqual(readdirSync(f.temp), [], "temporary downloads are removed");
    } finally { f.cleanup(); }
  });

  test(`${target}: a tampered asset fails the SHA-256 check and installs nothing`, { skip }, () => {
    const f = fixture(undefined, { target });
    try {
      const dir = join(f.releases, "latest", "download");
      const asset = readdirSync(dir).find(isInstallAsset);
      writeFileSync(join(dir, asset), Buffer.concat([readFileSync(join(dir, asset)), Buffer.from("tampered")]));
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SHA-256 mismatch/);
      assert.match(result.stderr, /Nothing was installed/);
      assert.equal(existsSync(f.installRoot), false);
      assert.equal(existsSync(join(f.home, ".local", "bin", "branch-agent")), false);
      assert.equal(existsSync(f.desktopEntry), false);
      assert.deepEqual(f.leftovers(), []);
    } finally { f.cleanup(); }
  });

  test(`${target}: a tampered upgrade leaves the existing install untouched`, { skip }, () => {
    const f = fixture(undefined, { target });
    try {
      assert.equal(f.run("--version", "v1.0.0").status, 0);
      const dir = join(f.releases, "latest", "download");
      const asset = readdirSync(dir).find(isInstallAsset);
      writeFileSync(join(dir, asset), "not the published bytes");
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SHA-256 mismatch/);
      assert.equal(f.installed(), "1.0.0");
      assert.deepEqual(f.leftovers(), []);
    } finally { f.cleanup(); }
  });

  test(`${target}: SHA256SUMS without an entry for the asset fails and installs nothing`, { skip }, () => {
    const f = fixture(undefined, { target });
    try {
      const sums = join(f.releases, "latest", "download", "SHA256SUMS");
      writeFileSync(sums, readFileSync(sums, "utf8").split("\n").filter(line => !isInstallAsset(line.split("  ")[1] ?? "")).join("\n"));
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /no single entry/);
      assert.equal(existsSync(f.installRoot), false);
    } finally { f.cleanup(); }
  });

  test(`${target}: --version selects that release's tag`, { skip }, () => {
    const f = fixture(undefined, { target });
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
}

test("Linux installs the AppImage, never the tar.gz, as an executable with a desktop entry, idempotently", { skip }, () => {
  const f = fixture(undefined, { target: "linux-x64" });
  try {
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Downloading Branch-Agent-1\.2\.3-linux-x64\.AppImage/);
    assert.doesNotMatch(first.stdout + first.stderr, /tar\.gz/);
    const published = join(f.releases, "latest", "download", "Branch-Agent-1.2.3-linux-x64.AppImage");
    assert.equal(sha256(f.installRoot), sha256(published));
    assert.equal(statSync(f.installRoot).mode & 0o777, 0o755);
    const entry = readFileSync(f.desktopEntry, "utf8");
    assert.match(entry, /^\[Desktop Entry\]$/m);
    assert.ok(entry.split("\n").includes(`Exec="${f.installRoot}" %U`), entry);
    assert.equal(existsSync(join(f.home, ".local", "share", "branch-agent")), false, "no unpacked tar.gz install");
    const second = f.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(sha256(f.installRoot), sha256(published));
    assert.equal(statSync(f.installRoot).mode & 0o777, 0o755);
    assert.equal(readFileSync(f.desktopEntry, "utf8"), entry);
    assert.deepEqual(readdirSync(join(f.home, ".local", "bin")), ["branch-agent"]);
    assert.deepEqual(readdirSync(join(f.home, ".local", "share", "applications")), ["branch-agent.desktop"]);
    assert.deepEqual(readdirSync(f.temp), []);
  } finally { f.cleanup(); }
});

test("Linux removes the earlier tar.gz install and leaves app data alone", { skip }, () => {
  const f = fixture(undefined, { target: "linux-x64" });
  try {
    const share = join(f.home, ".local", "share");
    const old = join(share, "branch-agent");
    mkdirSync(join(old, "resources"), { recursive: true });
    writeFileSync(join(old, "branch-agent"), "#!/bin/sh\n"); writeFileSync(join(old, "Branch Agent.bin"), "electron");
    mkdirSync(join(share, "BranchAgent")); writeFileSync(join(share, "BranchAgent", "config.json"), "{}");
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Removed the older tar\.gz install/);
    assert.equal(existsSync(old), false);
    assert.equal(readFileSync(join(share, "BranchAgent", "config.json"), "utf8"), "{}");
    // A folder by that name that is not the old install is left as it is.
    mkdirSync(old); writeFileSync(join(old, "notes.txt"), "mine");
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(join(old, "notes.txt"), "utf8"), "mine");
  } finally { f.cleanup(); }
});

test("a tampered AppImage leaves an installed AppImage and an earlier tar.gz install untouched", { skip }, () => {
  const f = fixture(undefined, { target: "linux-x64" });
  try {
    assert.equal(f.run("--version", "v1.0.0").status, 0);
    const before = sha256(f.installRoot);
    const old = join(f.home, ".local", "share", "branch-agent");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "branch-agent"), "#!/bin/sh\n"); writeFileSync(join(old, "Branch Agent.bin"), "electron");
    const dir = join(f.releases, "latest", "download");
    writeFileSync(join(dir, "Branch-Agent-1.2.3-linux-x64.AppImage"), "not the published bytes");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(sha256(f.installRoot), before);
    assert.equal(existsSync(join(old, "Branch Agent.bin")), true);
    assert.deepEqual(f.leftovers(), []);
  } finally { f.cleanup(); }
});

test("an ad-hoc release never replaces an app signed with the pinned release identity", { skip }, () => {
  const f = fixture(["1.0.0", "1.2.3"], { target: "darwin-arm64", signing: { "1.0.0": "identity", "1.2.3": "adhoc" } });
  try {
    const first = f.run("--version", "v1.0.0");
    assert.equal(first.status, 0, first.stderr);
    const downgrade = f.run();
    assert.notEqual(downgrade.status, 0);
    assert.match(downgrade.stderr, /signed with the Branch release identity and this release is ad-hoc signed/);
    assert.match(downgrade.stderr, /nothing was installed/);
    assert.equal(f.installed(), "1.0.0");
    assert.equal(readFileSync(join(f.installRoot, "Contents", "SIGNATURE"), "utf8"), "identity");
    assert.deepEqual(f.leftovers(), []);
  } finally { f.cleanup(); }
});

test("an ad-hoc release installs fresh and replaces an ad-hoc install", { skip }, () => {
  const f = fixture(["1.0.0", "1.2.3"], { target: "darwin-arm64", signing: { "1.0.0": "adhoc", "1.2.3": "adhoc" } });
  try {
    assert.equal(f.run("--version", "v1.0.0").status, 0);
    const upgrade = f.run();
    assert.equal(upgrade.status, 0, upgrade.stderr);
    assert.match(upgrade.stdout, /Code signature present/);
    assert.equal(f.installed(), "1.2.3");
  } finally { f.cleanup(); }
});

test("install.sh prefers /Applications/Branch.app and keeps fixture installs in HOME", { skip: process.platform === "win32" }, () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /choose_darwin_apps/);
  assert.match(source, /\[ -d \/Applications \] && \[ -w \/Applications \]/);
  assert.match(source, /dest="\$apps\/Branch\.app"/);
  assert.match(source, /BRANCH_INSTALL_BASE_URL/);
  assert.match(source, /\$HOME\/Applications/);
  assert.match(source, /lsregister/);
  assert.match(source, /open Branch from Applications/);
  assert.doesNotMatch(source, /Installed \$apps\/Branch Agent\.app/);
});

test("install.sh never uses sudo and passes shellcheck when it is installed", { skip: process.platform === "win32" }, () => {
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source.replace(/^\s*#.*$/gm, "").replace(/needs no sudo/g, ""), /\bsudo\b/);
  const ps1 = readFileSync(fileURLToPath(new URL("../install/install.ps1", import.meta.url)), "utf8");
  assert.match(ps1, /Get-FileHash/);
  assert.match(ps1, /\/CURRENTUSER/);
  assert.match(ps1, /current\.txt/, "the installed path follows the version pointer");
  assert.doesNotMatch(ps1, /RunAs/);
  const check = spawnSync("shellcheck", ["-s", "sh", script], { encoding: "utf8" });
  if (check.error?.code === "ENOENT") return;
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("CI lints install.ps1 with a PSScriptAnalyzer pinned by digest, never an unpinned Install-Module", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/desktop-checks.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const at = workflow.indexOf("- name: Lint install.ps1 with PSScriptAnalyzer");
  assert.ok(at !== -1);
  const step = workflow.slice(at, workflow.indexOf("\n      - name:", at + 1));
  assert.doesNotMatch(step, /Install-Module/);
  assert.match(step, /PSA_SHA256: b9969345f78251112fb75bdddc789be8689a343472a2e09762303aa03287afab/);
  assert.ok(step.indexOf("Get-FileHash") < step.indexOf("Expand-Archive") && step.indexOf("Expand-Archive") < step.indexOf("Import-Module"), "verified before unpacked or imported");
});
