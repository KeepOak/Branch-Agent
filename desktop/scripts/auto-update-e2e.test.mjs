// Desktop auto-update end to end: a fixture old install and a new release served over loopback HTTP, with the
// release's own SHA256SUMS, driven through the real staging and swap code for each platform's update path.
// `platform` and `appImage` on the install select another platform's path, so all three run on any OS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const desktopUpdate = await import(pathToFileURL(join(dist, "desktop-update.js")));
const { runHelper } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
const mac = await import(pathToFileURL(join(dist, "mac-applications.js")));
const OLD_ELECTRON = "44.5.1", NEW_ELECTRON = "45.0.0", VERSION = "0.4.5";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const exists = file => stat(file).then(() => true, () => false);
const pinned = `Identifier=${mac.MAC_BUNDLE_ID}\nTeamIdentifier=${mac.macReleaseSigning.teamId}\ndesignated => ${mac.macReleaseSigning.designatedRequirement}\n`;
const adhoc = `Identifier=${mac.MAC_BUNDLE_ID}\nSignature=adhoc\nTeamIdentifier=not set\ndesignated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n`;

/** The old install for a platform, inside a temp HOME, in the place that platform's installer puts it. */
async function oldInstall(home, platform) {
  if (platform === "linux") {
    const appImage = join(home, ".local/bin/branch-agent");
    const mount = join(home, "mount");
    await mkdir(join(home, ".local/bin"), { recursive: true }); await mkdir(join(mount, "resources"), { recursive: true });
    await writeFile(appImage, "#!/bin/sh\n# Branch Agent AppImage fixture\n# version 0.4.4\n", { mode: 0o755 });
    await writeFile(join(mount, "branch-agent"), "old runtime"); await writeFile(join(mount, "resources/app.asar"), "old desktop asar");
    return { appDir: mount, resourcesDir: join(mount, "resources"), executable: join(mount, "branch-agent"), electronVersion: OLD_ELECTRON,
      nodePath: process.execPath, appImage, platform };
  }
  if (platform === "win32") {
    const appDir = join(home, "AppData/Local/Programs/Branch Agent");
    await mkdir(join(appDir, "resources"), { recursive: true });
    await writeFile(join(appDir, "Branch Agent.exe"), "old runtime"); await writeFile(join(appDir, "resources/app.asar"), "old desktop asar");
    return { appDir, resourcesDir: join(appDir, "resources"), executable: join(appDir, "Branch Agent.exe"), electronVersion: OLD_ELECTRON,
      nodePath: process.execPath, platform };
  }
  const appDir = join(home, "Applications/Branch Agent.app");
  await mkdir(join(appDir, "Contents/MacOS"), { recursive: true }); await mkdir(join(appDir, "Contents/Resources"), { recursive: true });
  await writeFile(join(appDir, "Contents/MacOS/Branch Agent"), "old runtime"); await writeFile(join(appDir, "Contents/Resources/app.asar"), "old desktop asar");
  return { appDir, resourcesDir: join(appDir, "Contents/Resources"), executable: join(appDir, "Contents/MacOS/Branch Agent"), electronVersion: OLD_ELECTRON,
    nodePath: process.execPath, platform, readSignature: async () => pinned };
}

/** What the platform's installed copy holds now: the AppImage bytes, or the executable and app.asar. */
async function installed(install) {
  if (install.appImage) return readFile(install.appImage, "utf8");
  return `${await readFile(install.executable, "utf8")}|${await readFile(join(install.resourcesDir, "app.asar"), "utf8")}`;
}
const OLD = { linux: "#!/bin/sh\n# Branch Agent AppImage fixture\n# version 0.4.4\n", win32: "old runtime|old desktop asar", darwin: "old runtime|old desktop asar" };
const NEW = { linux: `#!/bin/sh\n# Branch Agent AppImage fixture\n# version ${VERSION}\n`, win32: "new runtime|new desktop asar", darwin: "new runtime|new desktop asar" };

/** A new release (engine, window, desktop app.asar and whole app, AppImage, SHA256SUMS) and an old install in HOME. */
async function fixture(platform, run, { tamper } = {}) {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "auto-update-e2e-"));
  const home = join(root, "home"), sources = join(root, "sources"), releaseDir = join(root, "release");
  const dataDir = join(home, "data");
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "old-engine") };
  const engine = join(sources, "engine"), window = join(sources, "window"), asar = join(sources, "asar"), app = join(sources, "app");
  for (const dir of [join(engine, "dist"), window, asar, join(app, "resources"), join(app, "Branch Agent.app/Contents/MacOS"), join(app, "Branch Agent.app/Contents/Resources"), dataDir])
    await mkdir(dir, { recursive: true });
  await writeFile(join(engine, "branch.mjs"), "export {};\n"); await writeFile(join(engine, "dist/entry.js"), "export {};\n");
  await writeFile(join(engine, "dist/build-info.json"), '{"version":"new"}'); await writeFile(join(window, "index.html"), "new window");
  await writeFile(join(asar, "app.asar"), "new desktop asar");
  await writeFile(join(app, "Branch Agent.exe"), "new runtime"); await writeFile(join(app, "resources/app.asar"), "new desktop asar");
  await writeFile(join(app, "Branch Agent.app/Contents/MacOS/Branch Agent"), "new runtime");
  await writeFile(join(app, "Branch Agent.app/Contents/Resources/app.asar"), "new desktop asar");
  const release = await makeComponentRelease({ version: VERSION, tag: `v${VERSION}`, engine, window, desktop: { app: asar, runtime: app, electronVersion: NEW_ELECTRON }, output: releaseDir });
  await writeFile(join(releaseDir, desktopUpdate.appImageAssetName(VERSION)), NEW.linux);
  const sums = [];
  for (const name of (await readdir(releaseDir)).sort()) sums.push(`${sha256(await readFile(join(releaseDir, name)))}  ${name}`);
  await writeFile(join(releaseDir, "SHA256SUMS"), sums.join("\n") + "\n");
  // A tampered file: the published bytes change after SHA256SUMS and the manifest were written.
  if (tamper === "asset") {
    const name = platform === "linux" ? desktopUpdate.appImageAssetName(VERSION) : new URL(release.components.desktopRuntime.url).pathname.split("/").at(-1);
    const bytes = await readFile(join(releaseDir, name)); bytes[bytes.length - 1] ^= 0xff; await writeFile(join(releaseDir, name), bytes);
  }
  if (tamper === "sums") {
    const runtime = new URL(release.components.desktopRuntime.url).pathname.split("/").at(-1);
    await writeFile(join(releaseDir, "SHA256SUMS"), sums.map(line => line.endsWith(` ${runtime}`) ? `${"0".repeat(64)}  ${runtime}` : line).join("\n") + "\n");
  }
  const server = createServer((request, response) => {
    createReadStream(join(releaseDir, decodeURIComponent(request.url.slice(1)))).on("error", () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = async (url, options) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${new URL(url).pathname.split("/").at(-1)}`, options);
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const savedHome = process.env.HOME; process.env.HOME = home;
  const install = await oldInstall(home, platform);
  try { await run({ root, cfg, release, request, install }); }
  finally {
    process.env.HOME = savedHome;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/** The plan the desktop hands its helper, for an app that has already exited; relaunch runs `args` under Node. */
async function helperPlan(cfg, args, confirmTimeoutMs) {
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  return { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args }, confirmTimeoutMs };
}
const confirmScript = async (root, cfg) => {
  const file = join(root, "confirm.cjs");
  await writeFile(file, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify(cfg)}).then(v=>process.stdout.write(String(v)));`);
  return file;
};
const KIND = { linux: "appimage", win32: "runtime", darwin: "runtime" };

for (const platform of ["linux", "win32", "darwin"]) {
  test(`${platform}: a verified update lands, relaunches and reports the new version`, () => fixture(platform, async ({ root, cfg, release, request, install }) => {
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
    const journal = await desktopUpdate.readDesktopJournal(cfg);
    assert.equal(journal.kind, KIND[platform]);
    assert.equal(journal.target, install.appImage ?? install.appDir);
    assert.equal(await installed(install), OLD[platform], "nothing changes while the old app runs");
    if (platform === "linux") {
      assert.equal(journal.staged, `${install.appImage}.update-${VERSION}`, "staged beside the running AppImage for an atomic rename");
      if (process.platform !== "win32") assert.equal((await stat(journal.staged)).mode & 0o777, 0o755);
    }
    const plan = await helperPlan(cfg, [await confirmScript(root, cfg)], 15_000);
    assert.equal(await runHelper(plan), "applied");
    assert.equal(await installed(install), NEW[platform]);
    assert.equal((await readFile(plan.versionFile, "utf8")).trim(), VERSION);
    assert.equal(await exists(plan.journal), false);
    if (platform === "linux") {
      assert.equal(await exists(journal.staged), false);
      if (process.platform !== "win32") assert.equal((await stat(install.appImage)).mode & 0o777, 0o755);
    }
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), false, "the new version does not update again");
  }));

  test(`${platform}: a tampered file is refused and the old install stays intact`, () => fixture(platform, async ({ cfg, release, request, install }) => {
    await assert.rejects(desktopUpdate.stageDesktopUpdate(cfg, release, request, install), /SHA256/);
    assert.equal(await installed(install), OLD[platform]);
    assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
    if (install.appImage) assert.deepEqual((await readdir(join(install.appImage, ".."))).sort(), ["branch-agent"], "no partial AppImage is left");
  }, { tamper: "asset" }));

  test(`${platform}: an interrupted swap rolls back to the old install`, () => fixture(platform, async ({ cfg, release, request, install }) => {
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
    const journal = await desktopUpdate.readDesktopJournal(cfg);
    await rm(journal.staged, { recursive: true, force: true }); // the new copy vanishes between moving the old one aside and placing it
    const plan = await helperPlan(cfg, ["-e", ""], 1000);
    assert.equal(await runHelper(plan), "kept");
    assert.equal(await installed(install), OLD[platform]);
    assert.equal(await exists(plan.versionFile), false);
  }));

  test(`${platform}: a new app that never confirms is stopped and the old install returns`, () => fixture(platform, async ({ cfg, release, request, install }) => {
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
    const plan = await helperPlan(cfg, ["-e", "setTimeout(() => {}, 4000)"], 1500);
    assert.equal(await runHelper(plan), "rolled-back");
    assert.equal(await installed(install), OLD[platform]);
    assert.equal(await exists(plan.versionFile), false);
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), false, "the rejected release is not retried");
  }));
}

for (const platform of ["win32", "darwin"]) {
  test(`${platform}: a component whose SHA256SUMS entry differs from the manifest is refused`, () => fixture(platform, async ({ cfg, release, request, install }) => {
    await assert.rejects(desktopUpdate.stageDesktopUpdate(cfg, release, request, install), /does not match the release's SHA256SUMS/);
    assert.equal(await installed(install), OLD[platform]);
    assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
  }, { tamper: "sums" }));
}

test("darwin: an app signed with the pinned identity is never replaced by an ad-hoc copy", () => fixture("darwin", async ({ cfg, release, request, install }) => {
  const signed = { ...install, readSignature: async app => app === install.appDir ? pinned : adhoc };
  await assert.rejects(desktopUpdate.stageDesktopUpdate(cfg, release, request, signed), /Refusing to replace a Branch app signed with the pinned release identity by an ad-hoc signed copy/);
  assert.equal(await installed(install), OLD.darwin);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, signed), false, "the refused release is not downloaded again");
  // A declared ad-hoc build updates an ad-hoc install.
  await rm(join(cfg.dataDir, "desktop-update-rejected.json"));
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, { ...install, readSignature: async () => adhoc }), true);
}));

test("Linux: a release without SHA256SUMS never updates an AppImage", () => fixture("linux", async ({ root, cfg, release, request, install }) => {
  await rm(join(root, "release", "SHA256SUMS"));
  await assert.rejects(desktopUpdate.stageDesktopUpdate(cfg, release, request, install), /Release download failed \(404\)/);
  assert.equal(await installed(install), OLD.linux);
}));

test("an install that already matches the release fetches nothing, not even SHA256SUMS", async () => {
  const src = readFileSync(new URL("../src/desktop-update.ts", import.meta.url), "utf8");
  const stage = src.slice(src.indexOf("export async function stageDesktopUpdate"));
  assert.ok(stage.indexOf("installedMatches(") < stage.indexOf("releaseSha256Sums("), "SHA256SUMS is fetched only after the install is known to differ");
});
