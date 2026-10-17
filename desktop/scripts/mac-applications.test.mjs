import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";

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

test("a first launch from Downloads or a disk image offers to move Branch.app into Applications", async () => {
  const home = await mkdtemp(join(tmpdir(), "mac-move-home-"));
  const data = await mkdtemp(join(tmpdir(), "mac-move-data-"));
  try {
    const system = "/Applications";
    const user = join(home, "Applications");
    const options = { systemApplications: system, homeDirectory: home };
    assert.equal(mac.MAC_MOVE_MESSAGE, "Move Branch to Applications so it is easy to find?");
    assert.equal(mac.MAC_MOVE_BUTTON, "Move");
    assert.equal(mac.MAC_NOT_NOW_BUTTON, "Not now");
    assert.doesNotMatch(mac.MAC_MOVE_MESSAGE, /[—–]/);
    assert.equal(mac.macAppIsInApplicationsFolder(join(system, "Branch.app"), options), true);
    assert.equal(mac.macAppIsInApplicationsFolder(join(user, "Branch.app"), options), true);
    assert.equal(mac.macAppIsInApplicationsFolder(join(user, "Branch Agent.app"), options), true);
    assert.equal(mac.shouldOfferMacApplicationsMove(join(home, "Downloads", "Branch.app"), options), true);
    assert.equal(mac.shouldOfferMacApplicationsMove(join("/Volumes", "Branch", "Branch.app"), options), true);
    assert.equal(mac.shouldOfferMacApplicationsMove(join("/private/var/folders/zz/AppTranslocation/abc/d/Branch.app"), options), true);
    assert.equal(mac.shouldOfferMacApplicationsMove(join(system, "Branch.app"), options), false);
    assert.equal(mac.shouldOfferMacApplicationsMove(join(user, "Branch.app"), options), false);
    assert.equal(mac.shouldOfferMacApplicationsMove(join(home, "Downloads", "Branch.app"), { ...options, declined: true }), false);
    assert.equal(mac.shouldOfferMacApplicationsMove(join(home, "src", "desktop"), options), false);
    assert.equal(mac.macLaunchLocationIsTransient(join(home, "Downloads", "Branch.app")), true);
    assert.equal(mac.macLaunchLocationIsTransient(join("/Volumes", "Branch", "Branch.app")), false);
    assert.equal(mac.macApplicationsExecutable(join(system, "Branch.app")), join(system, "Branch.app", "Contents", "MacOS", "Branch Agent"));

    const source = join(home, "Downloads", "Branch.app");
    await bundle(source);
    const installed = [];
    const removed = [];
    const moved = await mac.offerMacApplicationsMove({
      appDir: source,
      dataDir: data,
      ask: async () => "move",
      install: async (app, opts) => {
        installed.push({ app, running: opts.runningAppDir });
        return join(system, "Branch.app");
      },
      removeTransient: async app => { removed.push(app); },
    });
    assert.deepEqual(moved, { moved: true, relaunch: join(system, "Branch.app", "Contents", "MacOS", "Branch Agent") });
    assert.deepEqual(installed, [{ app: source, running: source }]);
    assert.deepEqual(removed, [source]);

    const skipped = await mac.offerMacApplicationsMove({
      appDir: join(system, "Branch.app"),
      dataDir: data,
      ask: async () => { throw new Error("already in Applications"); },
    });
    assert.deepEqual(skipped, { moved: false });

    const later = await mac.offerMacApplicationsMove({
      appDir: source,
      dataDir: data,
      ask: async () => "not-now",
    });
    assert.deepEqual(later, { moved: false });
    assert.equal(await mac.readMacMoveDeclined(data), true);
    const remembered = await mac.offerMacApplicationsMove({
      appDir: source,
      dataDir: data,
      ask: async () => { throw new Error("Not now was remembered"); },
    });
    assert.deepEqual(remembered, { moved: false });
    assert.deepEqual(await mac.offerMacApplicationsMove({ appDir: source, dataDir: data, skip: true }), { moved: false });
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
});

test("install.sh prefers /Applications/Branch.app and keeps fixture installs in HOME", { skip: process.platform === "win32" }, async () => {
  const source = await text("install/install.sh");
  assert.match(source, /choose_darwin_apps/);
  assert.match(source, /\[ -d \/Applications \] && \[ -w \/Applications \]/);
  assert.match(source, /dest="\$apps\/Branch\.app"/);
  assert.match(source, /BRANCH_INSTALL_BASE_URL/);
  assert.match(source, /\$HOME\/Applications/);
  assert.match(source, /lsregister/);
  assert.match(source, /open Branch from Applications/);
  assert.match(source, /BRANCH_INSTALL_BASE_URL[\s\S]*Branch Agent\.app/);
  assert.doesNotMatch(source.replace(/BRANCH_INSTALL_BASE_URL[\s\S]*?dest="\$apps\/Branch Agent\.app"/, ""), /Installed \$apps\/Branch Agent\.app/);
});

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

test("stamp shows the bundle as Branch and keeps the stable id, package type, and minimum system version", async () => {
  const { root, source, done } = await tempTree();
  try {
    await bundle(source);
    await mac.stampMacBundle(source);
    await mac.stampMacBundle(source);
    const stamped = await readFile(join(source, "Contents/Info.plist"), "utf8");
    // Electron looks its helpers up as "<CFBundleName> Helper.app"; only the display name is Branch.
    assert.equal(value(stamped, "CFBundleName"), "Branch Agent");
    assert.equal(value(stamped, "CFBundleDisplayName"), "Branch");
    assert.equal(stamped.split("<key>CFBundleDisplayName</key>").length, 2);
    assert.equal(value(stamped, "CFBundlePackageType"), "APPL");
    assert.equal(value(stamped, "CFBundleIdentifier"), mac.MAC_BUNDLE_ID);
    assert.equal(value(stamped, "CFBundleExecutable"), "Branch Agent");
    assert.equal(value(stamped, "LSMinimumSystemVersion"), "12.0");
    assert.match(stamped, /Branch document/);
    await assert.equal(mac.darwinPackagerOptions("/icons/branch.icns").appBundleId, mac.MAC_BUNDLE_ID);
    assert.deepEqual(mac.darwinPackagerOptions("/icons/branch.icns"), {
      name: "Branch Agent", executableName: "Branch Agent", appBundleId: "com.electron.branch-agent", icon: "/icons/branch.icns",
    });
  } finally { await done(); await rm(root, { recursive: true, force: true }); }
});

test("stamp refuses a packaged bundle whose helper does not match CFBundleName, and accepts the matching one", async () => {
  const { source, done } = await tempTree();
  try {
    await bundle(source);
    const helpers = join(source, "Contents/Frameworks");
    await mkdir(join(helpers, "Branch Helper.app/Contents/MacOS"), { recursive: true });
    await writeFile(join(helpers, "Branch Helper.app/Contents/MacOS/Branch Helper"), "wrong-helper");
    const before = await readFile(join(source, "Contents/Info.plist"), "utf8");
    await assert.rejects(mac.stampMacBundle(source), /Missing bundle file: Branch Agent Helper/);
    assert.equal(await readFile(join(source, "Contents/Info.plist"), "utf8"), before);
    await mkdir(join(helpers, "Branch Agent Helper.app/Contents/MacOS"), { recursive: true });
    await writeFile(join(helpers, "Branch Agent Helper.app/Contents/MacOS/Branch Agent Helper"), "helper");
    await mac.stampMacBundle(source);
    const stamped = await readFile(join(source, "Contents/Info.plist"), "utf8");
    assert.equal(value(stamped, "CFBundleName"), mac.MAC_HELPER_PREFIX);
  } finally { await done(); }
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

/**
 * Electron's fs reads and writes any path ending in .asar as an archive, so the installer's copy of a bundle's app.asar
 * fails with "Invalid package" (0.4.4-build-98a8dac57bb9 logged it on every launch). This fake fails the same way.
 */
function electronLikeFs(base) {
  const archive = path => /\.asar(?:[\\/]|$)/.test(String(path));
  const refuse = path => { if (archive(path)) throw new Error(`Invalid package ${path}`); };
  return {
    ...base,
    async mkdir(path, options) { refuse(path); return base.mkdir(path, options); },
    async rm(path, options) { refuse(path); return base.rm(path, options); },
    async rename(from, to) { refuse(from); refuse(to); return base.rename(from, to); },
    async cp(from, to, options) {
      for (const entry of await base.readdir(from, { recursive: true })) refuse(join(to, entry));
      return base.cp(from, to, options);
    },
  };
}

test("install copies a bundle that carries app.asar with a file API Electron does not read as an archive", async () => {
  const { apps, source, done } = await tempTree();
  const register = async () => {};
  try {
    await bundle(source);
    await writeFile(join(source, "Contents/Resources/app.asar"), "asar-bytes");
    await assert.rejects(mac.installMacApp(source, { applicationsDirectory: apps, register, stripQuarantine: async () => {}, fs: electronLikeFs(fsp) }), /Invalid package/);
    assert.equal((await readdir(apps)).some(name => name.startsWith(".Branch")), false);
    const installed = await mac.installMacApp(source, { applicationsDirectory: apps, register, stripQuarantine: async () => {} });
    assert.equal(await readFile(join(installed, "Contents/Resources/app.asar"), "utf8"), "asar-bytes");
    assert.equal((await lstat(join(installed, "Contents/Resources/app.asar"))).isFile(), true);
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

const pinnedReport = `Identifier=${mac.MAC_BUNDLE_ID}\nTeamIdentifier=${mac.macReleaseSigning.teamId}\ndesignated => ${mac.macReleaseSigning.designatedRequirement}\n`;
const adhocReport = `Identifier=${mac.MAC_BUNDLE_ID}\nCodeDirectory v=20400 size=500 flags=0x20002(adhoc,linker-signed) hashes=10+7 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\ndesignated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n`;

test("release signature check accepts ad-hoc only when the release declares adhoc", () => {
  assert.doesNotThrow(() => mac.assertMacReleaseSignature(adhocReport, "", "adhoc"));
  assert.throws(() => mac.assertMacReleaseSignature(adhocReport, ""), /ad-hoc signed but declares the pinned release identity/);
  assert.throws(() => mac.assertMacReleaseSignature(adhocReport, "", "identity"), /ad-hoc signed but declares/);
  assert.throws(() => mac.assertMacReleaseSignature(adhocReport.replace(mac.MAC_BUNDLE_ID, "com.example.other"), "", "adhoc"), /identifier differs/);
  assert.throws(() => mac.assertMacReleaseSignature(pinnedReport, mac.macReleaseSigning.identitySha1, "adhoc"), /declares ad-hoc signing but carries another signature/);
  assert.throws(() => mac.assertMacReleaseSignature("TeamIdentifier=not set\n", "", "adhoc"), /unsigned/);
  assert.throws(() => mac.assertMacReleaseSignature(pinnedReport, mac.macReleaseSigning.identitySha1, "self"), /Unknown declared macOS signing/);
});

test("an app signed with the pinned identity is never replaced by an ad-hoc or unsigned one", () => {
  assert.throws(() => mac.assertNoMacSigningDowngrade(pinnedReport, adhocReport), /Refusing to replace a Branch app signed with the pinned release identity by an ad-hoc signed copy/);
  assert.throws(() => mac.assertNoMacSigningDowngrade(pinnedReport, "code object is not signed at all"), /Refusing to replace/);
  assert.throws(() => mac.assertNoMacSigningDowngrade(pinnedReport, undefined), /Refusing to replace/);
  assert.doesNotThrow(() => mac.assertNoMacSigningDowngrade(pinnedReport, pinnedReport));
  assert.doesNotThrow(() => mac.assertNoMacSigningDowngrade(adhocReport, adhocReport));
  assert.doesNotThrow(() => mac.assertNoMacSigningDowngrade(adhocReport, pinnedReport));
  assert.doesNotThrow(() => mac.assertNoMacSigningDowngrade(undefined, adhocReport));
  assert.equal(mac.macSignatureIsPinnedIdentity(`${pinnedReport}Signature=adhoc\n`), false);
});

test("installMacApp refuses to swap a pinned-identity Branch.app for an ad-hoc bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-mac-downgrade-"));
  try {
    const apps = join(root, "Applications");
    const source = join(root, "stage", "Branch Agent.app");
    for (const [app, marker] of [[source, "adhoc"], [join(apps, "Branch.app"), "pinned"]]) {
      await mkdir(join(app, "Contents"), { recursive: true });
      await writeFile(join(app, "Contents", "Info.plist"), plist());
      await writeFile(join(app, "Contents", "MARKER"), marker);
    }
    const reports = { adhoc: adhocReport, pinned: pinnedReport };
    const readSignature = async app => reports[(await readFile(join(app, "Contents", "MARKER"), "utf8").catch(() => ""))];
    await assert.rejects(mac.installMacApp(source, { applicationsDirectory: apps, register: async () => {}, stripQuarantine: async () => {}, readSignature }), /Refusing to replace/);
    assert.equal(await readFile(join(apps, "Branch.app", "Contents", "MARKER"), "utf8"), "pinned");
    assert.deepEqual((await readdir(apps)).sort(), ["Branch.app"]);
    reports.adhoc = pinnedReport;
    await mac.installMacApp(source, { applicationsDirectory: apps, register: async () => {}, stripQuarantine: async () => {}, readSignature });
    assert.equal(await readFile(join(apps, "Branch.app", "Contents", "MARKER"), "utf8"), "adhoc");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release signature check rejects ad-hoc, unsigned, and drifted identity", () => {
  const designated = `designated => ${mac.macReleaseSigning.designatedRequirement}`;
  const good = `Identifier=${mac.MAC_BUNDLE_ID}\nTeamIdentifier=${mac.macReleaseSigning.teamId}\n${designated}\n`;
  assert.doesNotThrow(() => mac.assertMacReleaseSignature(good, mac.macReleaseSigning.identitySha1.toLowerCase()));
  assert.doesNotThrow(() => mac.assertMacReleaseSignature(good, mac.macReleaseSigning.identitySha1, "identity"));
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
  assert.match(release, /macSigningPlan\(\)/);
  assert.match(release, /signing: macSigning\.signing/);
  const stampAt = release.indexOf("await stampMacBundle");
  assert.ok(stampAt !== -1 && release.indexOf("macSignCommand(macSigning, join(app, MAC_ARCHIVE_BUNDLE_FOLDER))", stampAt) > stampAt);
  // The workflow reads the declared signing from the release proof and allows ad-hoc only for an "adhoc" build.
  assert.match(componentRelease, /signing="\$\(node -p 'JSON\.parse\(require\("node:fs"\)\.readFileSync\(process\.argv\[1\], "utf8"\)\)\.signing' "\$RELEASE_ASSETS\/release-proof-darwin-arm64\.json"\)"/);
  assert.match(componentRelease, /mod\.assertMacReleaseSignature\(text, actual, process\.argv\[3\]\);' "\$GITHUB_WORKSPACE\/desktop\/dist\/mac-applications\.js" "\$report" "\$signing"/);
  assert.match(updater, /ensureMacApplicationsInstall/);
  assert.match(updater, /chooseStagedMacBundle/);
  const launcher = await text("src/main.ts");
  assert.match(launcher, /offerMacApplicationsMove/);
  assert.match(launcher, /MAC_MOVE_MESSAGE/);
  assert.match(launcher, /app\.relaunch\(\{ execPath: move\.relaunch \}\)/);
  assert.match(helper, /lsregister/);
  assert.match(helper, /windowsHide: true/);
  assert.match(maker, /Branch Agent\.app\/Contents\/Resources\/app\.asar/);
  assert.match(componentRelease, /app="\$extracted\/Branch Agent\.app"/);
  assert.match(componentRelease, /test "\$fingerprint" = "\$BRANCH_MACOS_SIGNING_IDENTITY"/);
  assert.match(componentRelease, /codesign -dr - "\$app" 2>&1 \| grep -Fx 'designated => identifier "com\.electron\.branch-agent" and certificate root = H"30bbf0b68236ae05e063465c39dea6c5b396b11c"'/);
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.p12Secret));
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.passwordSecret));
  assert.match(componentRelease, new RegExp(mac.macReleaseSigning.identitySha1));
  assert.match(componentRelease, /assertMacReleaseSignature/);
  assert.match(checks, /scripts\/mac-applications\.test\.mjs/);
  assert.match(checks, /macOS Applications install/);
  assert.doesNotMatch(checks, /BRANCH_MACOS_SIGNING_P12/);
  assert.doesNotMatch(checks, /BRANCH_MACOS_SIGNING_PASSWORD/);
  assert.doesNotMatch(bundleCheck, /BRANCH_MACOS_SIGNING_P12/);
  assert.doesNotMatch(bundleCheck, /BRANCH_MACOS_SIGNING_PASSWORD/);
  assert.match(bundleCheck, /plutil/);
  assert.match(bundleCheck, /assets\/branch\.icns/);
  assert.match(release, /MAC_ARCHIVE_BUNDLE_FOLDER/);
  assert.equal(mac.MAC_BUNDLE_FOLDER, "Branch.app");
  assert.equal(mac.MAC_ARCHIVE_BUNDLE_FOLDER, "Branch Agent.app");
  assert.equal(mac.MAC_BUNDLE_ID, "com.electron.branch-agent");
});

test("a launch from Applications registers Branch.app and does not copy or delete it", async () => {
  const { root, done } = await tempTree();
  try {
    for (const apps of [join(root, "Applications"), join(root, "home", "Applications")]) {
      const running = join(apps, "Branch.app");
      await bundle(running);
      await writeFile(join(running, "Contents/Resources/marker.txt"), "live");
      const legacy = join(apps, "Branch Agent.app");
      await bundle(legacy);
      const before = await stat(running);
      const calls = [];
      const register = async args => { calls.push(args); };
      const installed = await mac.installMacApp(running, {
        applicationsDirectory: apps,
        runningAppDir: running,
        register,
      });
      const after = await stat(installed);
      assert.equal(installed, running);
      assert.equal(after.ino, before.ino, apps);
      assert.equal(await readFile(join(running, "Contents/Resources/marker.txt"), "utf8"), "live");
      assert.equal((await readdir(apps)).some(name => name.startsWith(".Branch.")), false, apps);
      assert.deepEqual(calls.filter(args => args[0] === "-f"), [["-f", running]]);
      assert.equal(calls.some(args => args[0] === "-u" && args[1] === running), false);
      assert.equal((await readdir(apps)).includes("Branch Agent.app"), false, apps);
      const linked = join(root, `linked-${apps.endsWith(`${join("home", "Applications")}`) ? "home" : "system"}.app`);
      await symlink(running, linked);
      const viaLink = await mac.installMacApp(linked, { applicationsDirectory: apps, runningAppDir: linked, register });
      assert.equal((await stat(viaLink)).ino, before.ino, apps);
    }
  } finally { await done(); }
});

test("a staged or postponed desktop update does not republish the running app", async () => {
  const updater = await text("src/desktop-update.ts");
  const handoff = updater.slice(updater.indexOf("export async function handOffDesktopUpdate"));
  const early = handoff.slice(0, handoff.indexOf("const work"));
  assert.match(early, /readDesktopJournal\(cfg\)/);
  assert.match(early, /phase === "staged"/);
  assert.doesNotMatch(early, /heldUntil \?\? 0\) > Date\.now\(\)\) \{\s*await ensureMacApplicationsInstall/);
  assert.match(early, /if \(!updateWaiting\) await ensureMacApplicationsInstall/);
});

test("darwin desktop tarball root stays Branch Agent.app", async () => {
  const root = await mkdtemp(join(tmpdir(), "mac-archive-"));
  try {
    const engine = join(root, "engine"), window = join(root, "window"), asar = join(root, "asar"), app = join(root, "runtime");
    await mkdir(join(engine, "dist"), { recursive: true });
    await mkdir(window);
    await mkdir(asar);
    await bundle(join(app, "Branch Agent.app"));
    await writeFile(join(app, "Branch Agent.app/Contents/Resources/app.asar"), "sealed asar");
    await writeFile(join(engine, "branch.mjs"), "export {};\n");
    await writeFile(join(engine, "dist/entry.js"), "export {};\n");
    await writeFile(join(engine, "dist/build-info.json"), "{}");
    await writeFile(join(window, "index.html"), "window");
    await writeFile(join(asar, "app.asar"), "sealed asar");
    const output = join(root, "out");
    const release = await makeComponentRelease({
      version: "0.4.4", tag: "v0.4.4", engine, window, output, platform: "darwin", arch: "arm64",
      desktop: { app: asar, runtime: app, electronVersion: "44.5.1" },
    });
    assert.match(release.components.desktopRuntime.appAsarSha256, /^[a-f0-9]{64}$/);
    const archive = gunzipSync(await readFile(join(output, "branch-desktop-0.4.4-darwin-arm64.tar.gz")));
    assert.ok(archive.includes(Buffer.from("Branch Agent.app/Contents/Resources/app.asar")));
    assert.equal(archive.includes(Buffer.from("Branch.app/")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
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
