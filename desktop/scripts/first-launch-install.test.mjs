import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const launch = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "first-launch-install.js")));

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "first-launch-install-"));
  try {
    const engine = join(root, "source-engine");
    const window = join(root, "source-window");
    const output = join(root, "release");
    const cfg = { dataDir: join(root, "data"), windowDir: join(root, "data", "window-current"), engineDir: join(root, "old-engine") };
    await mkdir(join(engine, "dist"), { recursive: true });
    await mkdir(window);
    await mkdir(cfg.dataDir);
    await writeFile(join(engine, "branch.mjs"), "console.log('fixture');\n");
    await writeFile(join(engine, "dist", "entry.js"), "export {};\n");
    await writeFile(join(engine, "dist", "build-info.json"), '{"version":"new"}');
    await writeFile(join(window, "index.html"), "<title>installed window</title>");
    const release = await makeComponentRelease({ version: "0.4.3", tag: "v0.4.3", engine, window, output });
    let downloads = 0;
    let failDownload = false;
    let consent = false;
    const request = async url => {
      const filename = new URL(url).pathname.split("/").at(-1);
      if (filename.endsWith(".json")) return new Response(JSON.stringify(release));
      assert.equal(consent, true, "no component download before Download is chosen");
      downloads++;
      if (failDownload) throw new Error("Download interrupted");
      return new Response(await readFile(join(output, filename)));
    };
    await run({ cfg, request, downloads: () => downloads,
      consent: value => { consent = value; }, failDownload: value => { failDownload = value; } });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

// Execute the actual generated renderer scripts. Buttons only exist when the page renders them.
function renderer(onPage) {
  const elements = new Map();
  let html = "";
  const document = {
    body: { style: {}, get innerHTML() { return html; }, set innerHTML(value) {
      html = value;
      elements.clear();
      for (const match of value.matchAll(/id="([^"]+)"[^>]*>([^<]*)/g)) {
        const listeners = [];
        elements.set(match[1], { textContent: match[2], addEventListener: (event, callback) => {
          if (event === "click") listeners.push(callback);
        }, click: () => listeners.forEach(callback => callback()) });
      }
      queueMicrotask(() => onPage({ html, elements }));
    } },
    getElementById: id => elements.get(id),
  };
  return { isDestroyed: () => false, webContents: {
    executeJavaScript: async code => runInNewContext(code, { document }),
  } };
}

for (const path of ["initial Cancel", "failed download then Retry Cancel"]) {
  for (const action of ["Quit", "Download again"]) {
    test(`${path}: ${action} works from the recovery page`, { timeout: 15000 }, async () => fixture(async context => {
      const { cfg, request } = context;
      const failedPath = path.startsWith("failed");
      context.failDownload(failedPath);
      const initialPrompts = [];
      const initial = await launch.runFirstLaunchInstall(cfg, request, {
        ask: async prompt => {
          initialPrompts.push(prompt.kind);
          if (prompt.kind === "confirm") {
            assert.equal(context.downloads(), 0);
            context.consent(failedPath);
            return failedPath;
          }
          assert.ok(context.downloads() > 0);
          return false;
        },
      });
      assert.equal(initial, "cancelled");
      assert.deepEqual(initialPrompts, failedPath ? ["confirm", "retry"] : ["confirm"]);
      context.consent(false);
      context.failDownload(false);
      const beforeRecovery = context.downloads();
      let pages = 0;
      let confirmations = 0;
      const win = renderer(({ html, elements }) => {
        const primary = elements.get("branch-first-launch-yes");
        const secondary = elements.get("branch-first-launch-cancel");
        assert.ok(primary, "recovery and confirmation pages must offer a primary button");
        assert.ok(secondary, "recovery and confirmation pages must offer a secondary button");
        assert.equal(context.downloads(), beforeRecovery, "opening recovery or confirmation must not download");
        if (html.includes("Branch needs these components to open.")) {
          pages++;
          assert.equal(primary.textContent, "Download again");
          assert.equal(secondary.textContent, "Quit");
          assert.match(html, /The download did not finish\./);
          (action === "Quit" ? secondary : primary).click();
        } else {
          confirmations++;
          assert.equal(primary.textContent, "Download");
          assert.equal(secondary.textContent, "Cancel");
          assert.match(html, /\d+(?:\.\d+)? (?:MB|GB)/);
          if (confirmations === 1) secondary.click();
          else { context.consent(true); primary.click(); }
        }
      });
      const outcome = await launch.recoverFirstLaunchInstall(win, cfg, request, {
        choose: () => win.webContents.executeJavaScript(launch.firstLaunchNeedComponentsScript()),
      });
      if (action === "Quit") {
        assert.equal(outcome, "quit");
        assert.equal(launch.firstLaunchAllowsWindow(outcome), false);
        assert.equal(pages, 1);
        assert.equal(confirmations, 0);
        assert.equal(context.downloads(), beforeRecovery);
      } else {
        assert.equal(outcome, "installed");
        assert.equal(launch.firstLaunchAllowsWindow(outcome), true);
        assert.equal(pages, 2, "Cancel at the new prompt returns to the same two-button page");
        assert.equal(confirmations, 2);
        assert.ok(context.downloads() > beforeRecovery);
        assert.equal(await readFile(join(cfg.windowDir, "index.html"), "utf8"), "<title>installed window</title>");
      }
    }));
  }
}
