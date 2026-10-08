import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const desktop = join(dist, "..");
const repo = join(desktop, "..");
const mac = await import(pathToFileURL(join(dist, "mac-applications.js")));
const text = file => readFile(join(desktop, file), "utf8");

function plist({ id = mac.MAC_BUNDLE_ID, name = "Branch Agent", display = "", icon = "branch", minimum = "12.0" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>Branch Agent</string>
	<key>CFBundleIconFile</key>
	<string>${icon}</string>
	<key>CFBundleIdentifier</key>
	<string>${id}</string>
	<key>CFBundleName</key>
	<string>${name}</string>
	${display ? `<key>CFBundleDisplayName</key>\n\t<string>${display}</string>` : ""}
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	${minimum ? `<key>LSMinimumSystemVersion</key>\n\t<string>${minimum}</string>` : ""}
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>Branch document</string>
		</dict>
	</array>
</dict>
</plist>
`;
}

async function bundle(dir, options) {
  await mkdir(join(dir, "Contents/MacOS"), { recursive: true });
  await mkdir(join(dir, "Contents/Resources"), { recursive: true });
  await writeFile(join(dir, "Contents/MacOS/Branch Agent"), "branch-executable");
  await writeFile(join(dir, "Contents/Resources/branch.icns"), "icns-bytes");
  await writeFile(join(dir, "Contents/Info.plist"), plist(options));
  return dir;
}

async function tempTree() {
  const root = await mkdtemp(join(tmpdir(), "mac-applications-"));
  return { root, apps: join(root, "Applications"), source: join(root, "Source.app"), done: () => rm(root, { recursive: true, force: true }) };
}

function value(plistText, key) {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plistText)?.[1];
}

test("Applications directory prefers a writable system folder, then the home folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "mac-applications-home-"));
  try {
    assert.equal(await mac.chooseApplicationsDirectory({
      systemApplications: "/Applications",
      homeDirectory: home,
      canWrite: async directory => directory === "/Applications",
    }), "/Applications");
    const user = await mac.chooseApplicationsDirectory({
      systemApplications: "/Applications",
      homeDirectory: home,
      canWrite: async () => false,
    });
    assert.equal(user, join(home, "Applications"));
    assert.equal((await readdir(home)).includes("Applications"), true);
    const explicit = join(home, "chosen");
    assert.equal(await mac.chooseApplicationsDirectory({
      applicationsDirectory: explicit,
      canWrite: async () => true,
    }), explicit);
    await assert.rejects(mac.chooseApplicationsDirectory({ applicationsDirectory: "relative" }), /must be absolute/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("stamp names the bundle Branch and keeps the stable id, package type, and minimum system version", async () => {
  const { root, source, done } = await tempTree();
  try {
    await bundle(source);
    await mac.stampMacBundle(source);
    await mac.stampMacBundle(source);
    const stamped = await readFile(join(source, "Contents/Info.plist"), "utf8");
    assert.equal(value(stamped, "CFBundleName"), "Branch");
    assert.equal(value(stamped, "CFBundleDisplayName"), "Branch");
    assert.equal(stamped.split("<key>CFBundleDisplayName</key>").length, 2);
    assert.equal(value(stamped, "CFBundlePackageType"), "APPL");
    assert.equal(value(stamped, "CFBundleIdentifier"), mac.MAC_BUNDLE_ID);
    assert.equal(value(stamped, "CFBundleExecutable"), "Branch Agent");
    assert.equal(value(stamped, "LSMinimumSystemVersion"), "12.0");
    assert.match(stamped, /Branch document/);
    await assert.equal(mac.darwinPackagerOptions("/icons/branch.icns").appBundleId, mac.MAC_BUNDLE_ID);
    assert.deepEqual(mac.darwinPackagerOptions("/icons/branch.icns"), {
      name: "Branch", executableName: "Branch Agent", appBundleId: "com.electron.branch-agent", icon: "/icons/branch.icns",
    });
  } finally { await done(); await rm(root, { recursive: true, force: true }); }
});

test("stamp refuses a bundle that is missing its executable or icon and leaves the plist unchanged", async () => {
  const { root, source, done } = await tempTree();
  try {
    await bundle(source);
    await rm(join(source, "Contents/MacOS/Branch Agent"));
    const before = await readFile(join(source, "Contents/Info.plist"), "utf8");
    await assert.rejects(mac.stampMacBundle(source), /Missing bundle file/);
    assert.equal(await readFile(join(source, "Contents/Info.plist"), "utf8"), before);
  } finally { await done(); }
});

test("install publishes one Branch.app, replaces it in place, and registers it", async () => {
  const { root, apps, source, done } = await tempTree();
  const calls = [];
  const quarantines = [];
  try {
    await bundle(source);
    await writeFile(join(source, "Contents/Resources/marker.txt"), "one");
    const register = async args => { calls.push(args); };
    const first = await mac.installMacApp(source, { applicationsDirectory: apps, register, stripQuarantine: async app => { quarantines.push(app); } });
    assert.equal(first, join(apps, "Branch.app"));
    assert.deepEqual(calls[0], ["-f", first]);
    assert.deepEqual(calls[1], ["-u", source]);
    assert.equal(quarantines.length, 1);
    await writeFile(join(source, "Contents/Resources/marker.txt"), "two");
    calls.length = 0;
    await mac.installMacApp(source, { applicationsDirectory: apps, register, stripQuarantine: async () => {} });
    assert.equal(await readFile(join(apps, "Branch.app/Contents/Resources/marker.txt"), "utf8"), "two");
    assert.deepEqual((await readdir(apps)).filter(name => name.endsWith(".app") || name.startsWith(".")), ["Branch.app"]);
    await mac.installMacApp(first, { applicationsDirectory: apps, register: async args => { calls.push(args); } });
    assert.equal(calls.some(args => args[0] === "-u" && args[1] === first), false);
  } finally { await done(); }
});

test("install removes a same-id legacy app, keeps a running one, and keeps a foreign or linked one", async () => {
  const { root, apps, source, done } = await tempTree();
  try {
    await bundle(source);
    const legacy = join(apps, "Branch Agent.app");
    await bundle(legacy);
    const calls = [];
    await mac.installMacApp(source, { applicationsDirectory: apps, register: async args => { calls.push(args); } });
    assert.equal((await readdir(apps)).includes("Branch Agent.app"), false);
    assert.equal(calls.some(args => args[0] === "-u" && args[1] === legacy), true);

    await bundle(legacy);
    const kept = [];
    await mac.installMacApp(source, {
      applicationsDirectory: apps,
      runningAppDir: legacy,
      register: async args => { kept.push(args); },
    });
    assert.equal(await readFile(join(legacy, "Contents/MacOS/Branch Agent"), "utf8"), "branch-executable");
    assert.equal(kept.some(args => args[0] === "-u" && args[1] === legacy), true);

    await bundle(legacy, { id: "com.example.other" });
    await mac.installMacApp(source, { applicationsDirectory: apps, register: async () => {} });
    assert.equal(value(await readFile(join(legacy, "Contents/Info.plist"), "utf8"), "CFBundleIdentifier"), "com.example.other");

    await rm(legacy, { recursive: true, force: true });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, legacy);
    await mac.installMacApp(source, { applicationsDirectory: apps, register: async () => {} });
    assert.equal((await readdir(apps)).includes("Branch Agent.app"), true);
    await assert.rejects(mac.installMacApp(join(root, "missing"), { applicationsDirectory: apps }), /CFBundleIdentifier|ENOENT/);
    const wrong = join(root, "Wrong.app");
    await bundle(wrong, { id: "com.example.other" });
    await assert.rejects(mac.installMacApp(wrong, { applicationsDirectory: apps }), /Refusing to install/);
    assert.equal((await readdir(apps)).filter(name => name.endsWith(".app")).length, 2);
  } finally { await done(); }
});

test("staged macOS payloads fall back from the installed name to Branch.app", () => {
  assert.equal(mac.chooseStagedMacBundle("/Installed/Branch Agent.app", ["Branch.app"]), "Branch.app");
  assert.equal(mac.chooseStagedMacBundle("/Installed/Branch.app", ["Branch Agent.app", "Branch.app"]), "Branch.app");
  assert.equal(mac.chooseStagedMacBundle("/Installed/Other.app", ["Branch Agent.app"]), "Branch Agent.app");
  assert.throws(() => mac.chooseStagedMacBundle("/Installed/Other.app", ["resources"]), /missing/i);
  assert.equal(mac.pathStaysInside("/Applications", "/Applications/Branch Agent.app"), true);
  assert.equal(mac.pathStaysInside("/Applications", "/etc"), false);
  assert.equal(mac.pathStaysInside("/Applications", "/Applications"), false);
});

test("release signature check rejects ad-hoc, unsigned, and drifted identity", () => {
  const designated = `designated => ${mac.macReleaseSigning.designatedRequirement}`;
  const good = `Identifier=${mac.MAC_BUNDLE_ID}\nTeamIdentifier=${mac.macReleaseSigning.teamId}\n${designated}\n`;
  assert.doesNotThrow(() => mac.assertMacReleaseSignature(good, mac.macReleaseSigning.identitySha1.toLowerCase()));
  assert.throws(() => mac.assertMacReleaseSignature(`${good}Signature=adhoc\n`, mac.macReleaseSigning.identitySha1), /ad-hoc/);
  assert.throws(() => mac.assertMacReleaseSignature("TeamIdentifier=not set\n", mac.macReleaseSigning.identitySha1), /unsigned/);
  assert.throws(() => mac.assertMacReleaseSignature(good.replace(designated, "designated => identifier \"other\""), mac.macReleaseSigning.identitySha1), /designated requirement/);
  assert.throws(() => mac.assertMacReleaseSignature(good.replace("TeamIdentifier=not set", "TeamIdentifier=ABCDE12345"), mac.macReleaseSigning.identitySha1), /TeamIdentifier/);
  assert.throws(() => mac.assertMacReleaseSignature(good, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), /fingerprint/);
});

test("packaging, updates, and CI keep the Applications install and the pinned signature", async () => {
  const release = await text("scripts/release-build.mjs");
  const updater = await text("src/desktop-update.ts");
  const helper = await text("src/desktop-update-helper.ts");
  const maker = await text("scripts/make-component-release.mjs");
  const componentRelease = await readFile(join(repo, ".github/workflows/component-release.yml"), "utf8");
  const checks = await readFile(join(repo, ".github/workflows/desktop-checks.yml"), "utf8");
  const bundleCheck = await text("scripts/check-mac-bundle.mjs");
  assert.match(release, /darwinPackagerOptions\(macIcon\)/);
  assert.match(release, /assets\/branch\.icns/);
  assert.doesNotMatch(release, /adhoc/);
  assert.match(release, /macOS releases require a stable code-signing identity/);
  const stampAt = release.indexOf("await stampMacBundle");
  assert.ok(stampAt !== -1 && release.indexOf('["sign"', stampAt) > stampAt);
  assert.match(updater, /ensureMacApplicationsInstall/);
  assert.match(updater, /chooseStagedMacBundle/);
  assert.match(helper, /lsregister/);
  assert.match(helper, /windowsHide: true/);
  assert.match(maker, /Branch\.app\/Contents\/Resources\/app\.asar/);
  assert.match(componentRelease, /Branch\.app/);
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.p12Secret));
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.passwordSecret));
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.identitySha1));
  assert.match(componentRelease, /assertMacReleaseSignature/);
  assert.match(checks, /scripts\/mac-applications\.test\.mjs/);
  assert.match(checks, /macOS Applications install/);
  assert.match(checks, new RegExp(mac.macReleaseSigning.p12Secret));
  assert.match(checks, new RegExp(mac.macReleaseSigning.passwordSecret));
  assert.match(bundleCheck, /plutil/);
  assert.match(bundleCheck, /assets\/branch\.icns/);
  assert.equal(mac.MAC_BUNDLE_FOLDER, "Branch.app");
  assert.equal(mac.MAC_BUNDLE_ID, "com.electron.branch-agent");
});

test("install CLI copies Branch.app into the requested Applications directory", async () => {
  const { root, apps, source, done } = await tempTree();
  try {
    await bundle(source);
    const result = spawnSync(process.execPath, [join(desktop, "scripts/install-mac-app.mjs"), source], {
      env: { ...process.env, BRANCH_MAC_APPLICATIONS: apps, BRANCH_DESKTOP_TEST_DIST: dist },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(apps, "Branch.app/Contents/MacOS/Branch Agent"), "utf8"), "branch-executable");
    assert.match(result.stdout, /Branch\.app/);
  } finally { await done(); }
});
