// Packages a macOS Branch.app, installs it into a temporary Applications folder, and checks the bundle.
// When the release signing secrets are present, the signed bundle must match the pinned identity.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(desktopRoot, "package.json"));
const RCODESIGN_URL = "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-aarch64-apple-darwin.tar.gz";
const RCODESIGN_SHA256 = "d1a532150adaf90048260d76359261aa716abafc45c53c5dc18845029184334a";

if (process.platform !== "darwin") {
  console.error("check-mac-bundle.mjs runs on macOS");
  process.exit(1);
}

function plistString(plist, key) {
  const value = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
  if (value === undefined) throw new Error(`Info.plist is missing ${key}`);
  return value;
}

function icnsTypes(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "icns");
  assert.equal(bytes.readUInt32BE(4), bytes.length);
  const types = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32BE(offset + 4);
    assert.ok(size >= 8, `icns chunk ${type} is too small`);
    types.push(type);
    offset += size;
  }
  return types;
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
}

function captureAll(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}\n${result.stderr ?? ""}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const temp = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "branch-mac-bundle-"));
try {
  const { darwinPackagerOptions, stampMacBundle, installMacApp, assertMacReleaseSignature, macReleaseSigning, MAC_BUNDLE_FOLDER, MAC_EXECUTABLE_NAME } = await import(pathToFileURL(join(desktopRoot, "dist/mac-applications.js")));
  const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  const appDirectory = join(temp, "app");
  await mkdir(appDirectory);
  await writeFile(join(appDirectory, "package.json"), JSON.stringify({ name: "branch", version: packageJson.version, main: "main.js" }));
  await writeFile(join(appDirectory, "main.js"), "\n");
  const { packager } = require("@electron/packager");
  const icon = join(desktopRoot, "assets/branch.icns");
  const folders = await packager({
    dir: appDirectory,
    platform: "darwin",
    arch: process.arch,
    electronVersion: packageJson.devDependencies.electron,
    asar: true,
    out: join(temp, "packaged"),
    prune: false,
    overwrite: true,
    ...darwinPackagerOptions(icon),
  });
  assert.equal(folders.length, 1);
  const packaged = join(folders[0], MAC_BUNDLE_FOLDER);
  await stampMacBundle(packaged);
  const applications = join(temp, "Applications");
  const installed = await installMacApp(packaged, { applicationsDirectory: applications });
  await installMacApp(packaged, { applicationsDirectory: applications });
  const names = await readdir(applications);
  assert.deepEqual(names.filter(name => name.endsWith(".app")), [MAC_BUNDLE_FOLDER]);
  const plistPath = join(installed, "Contents/Info.plist");
  const plist = await readFile(plistPath, "utf8");
  execFileSync("plutil", ["-lint", plistPath], { stdio: "ignore", windowsHide: true });
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    assert.equal(plistString(plist, key), "Branch");
    assert.equal(capture("plutil", ["-extract", key, "raw", "-o", "-", plistPath]).replaceAll('"', ""), "Branch");
  }
  assert.equal(plistString(plist, "CFBundlePackageType"), "APPL");
  assert.equal(capture("plutil", ["-extract", "CFBundlePackageType", "raw", "-o", "-", plistPath]).replaceAll('"', ""), "APPL");
  assert.equal(plistString(plist, "CFBundleIdentifier"), macReleaseSigning.bundleId);
  assert.equal(plistString(plist, "CFBundleExecutable"), MAC_EXECUTABLE_NAME);
  const executable = join(installed, "Contents/MacOS", MAC_EXECUTABLE_NAME);
  assert.equal((await readFile(executable)).length > 0, true);
  const iconName = plistString(plist, "CFBundleIconFile");
  const iconFile = join(installed, "Contents/Resources", iconName.endsWith(".icns") ? iconName : `${iconName}.icns`);
  const shipped = await readFile(iconFile);
  const sourceIcon = await readFile(icon);
  assert.deepEqual(shipped, sourceIcon);
  const types = icnsTypes(shipped);
  assert.deepEqual(types, icnsTypes(sourceIcon));
  assert.ok(types.includes("icp4") && types.includes("ic10"), "bundled icon is missing a required size");
  execFileSync("mdls", [installed], { stdio: "ignore", windowsHide: true });

  const p12 = process.env[macReleaseSigning.p12Secret] ?? "";
  const password = process.env[macReleaseSigning.passwordSecret] ?? "";
  if (!p12 && !password) {
    const line = `MISSING: stable macOS signing is not configured for this job. Add repository secrets ${macReleaseSigning.p12Secret} and ${macReleaseSigning.passwordSecret} (the same names component-release already uses). Bundle install checks passed; the signature was not verified.`;
    console.error(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  } else if (!p12 || !password) {
    throw new Error(`macOS signing needs both ${macReleaseSigning.p12Secret} and ${macReleaseSigning.passwordSecret}`);
  } else {
    const response = await fetch(RCODESIGN_URL);
    if (!response.ok) throw new Error(`rcodesign download failed (${response.status})`);
    const archive = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(archive).digest("hex"), RCODESIGN_SHA256, "rcodesign archive hash differs");
    const archivePath = join(temp, "rcodesign.tar.gz");
    writeFileSync(archivePath, archive);
    execFileSync("tar", ["-xzf", archivePath, "-C", temp], { windowsHide: true });
    const rcodesign = join(temp, "apple-codesign-0.29.0-aarch64-apple-darwin/rcodesign");
    const p12Path = join(temp, "signing.p12");
    const passwordPath = join(temp, "signing-password");
    writeFileSync(p12Path, Buffer.from(p12, "base64"), { mode: 0o600 });
    writeFileSync(passwordPath, password, { mode: 0o600 });
    chmodSync(p12Path, 0o600);
    chmodSync(passwordPath, 0o600);
    execFileSync(rcodesign, ["sign", "--p12-file", p12Path, "--p12-password-file", passwordPath, installed], { windowsHide: true, stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", installed], { windowsHide: true, stdio: "inherit" });
    execFileSync("codesign", ["-d", "--extract-certificates", installed], { cwd: temp, windowsHide: true, stdio: "ignore" });
    const fingerprint = captureAll("openssl", ["x509", "-inform", "DER", "-in", join(temp, "codesign0"), "-noout", "-fingerprint", "-sha1"]);
    const sha1 = (fingerprint.split("=")[1] ?? "").replaceAll(":", "").trim();
    const details = captureAll("codesign", ["-dv", "--verbose=4", installed]);
    const requirement = captureAll("codesign", ["-dr", "-", installed]);
    assertMacReleaseSignature(`${details}\n${requirement}\n`, sha1);
    console.log("macOS bundle check passed, including the pinned signing identity");
  }
  if (!p12 && !password) console.log("macOS bundle check passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
