import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PORTS,
  freePort,
  openOwnerWindow,
  ownerControlAllowed,
  launchBrowser,
  readDevToolsPort,
  scratchEngineEnv,
  serveWindow,
} from "./ui-target.js";
import { CONTROL_BANNER_JS, locate, UiSession, unlabeledControls } from "./ui-tools.js";

const dirs: string[] = [];
function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-ui-tools-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ui tools: what the agent is told about the window", () => {
  it("lists only interactive controls with no name and no text of their own", () => {
    const snapshot = [
      '- button "Settings" [ref=e1] [cursor=pointer]',
      "- button [ref=e2] [cursor=pointer]:",
      '  - emphasis [ref=e3]: "1"',
      "  - text: Welcome",
      "- button [ref=e4] [cursor=pointer]:",
      "  - img [ref=e5]",
      "- textbox [ref=e6]:",
      "  - /placeholder: Search",
      '- heading "Usage" [level=1] [ref=e7]',
      "- link [ref=e8]",
    ].join("\n");
    expect(unlabeledControls(snapshot)).toEqual([
      "- button [ref=e4] [cursor=pointer]:",
      "- textbox [ref=e6]:",
      "- link [ref=e8]",
    ]);
  });
});

describe("ui tools: which window they may touch", () => {
  it("leaves the owner's window alone unless the owner turned agent control on", async () => {
    const data = scratch();
    expect(ownerControlAllowed(data)).toBe(false);
    await expect(openOwnerWindow(data)).rejects.toThrow(/Let agents use this window/);
    fs.writeFileSync(
      path.join(data, "desktop-settings.json"),
      JSON.stringify({ agentControl: false }),
    );
    expect(ownerControlAllowed(data)).toBe(false);
    fs.writeFileSync(
      path.join(data, "desktop-settings.json"),
      JSON.stringify({ agentControl: true }),
    );
    expect(ownerControlAllowed(data)).toBe(true);
    await expect(openOwnerWindow(data)).rejects.toThrow(/restart Branch/);
  });

  it("reads the remote debugging port Chromium wrote for the desktop window", () => {
    const data = scratch();
    expect(readDevToolsPort(data)).toBeUndefined();
    fs.mkdirSync(path.join(data, "electron"));
    fs.writeFileSync(
      path.join(data, "electron", "DevToolsActivePort"),
      "51234\n/devtools/browser/abc\n",
    );
    expect(readDevToolsPort(data)).toBe(51234);
  });

  it("gives the test Branch its own home, profile and port, never the owner's", async () => {
    const dir = scratch();
    const env = scratchEngineEnv(dir, 45678, "t", {
      BRANCH_STATE_DIR: "C:/owner/state",
      BRANCH_GATEWAY_PASSWORD: "owner",
      LOCALAPPDATA: "C:/Users/owner/AppData/Local",
      PATH: "p",
    });
    expect(env.BRANCH_HOME).toBe(path.join(dir, "home"));
    expect(env.LOCALAPPDATA).toBe(path.join(dir, "profile", "AppData", "Local"));
    expect(env.BRANCH_GATEWAY_PORT).toBe("45678");
    expect(env).not.toHaveProperty("BRANCH_STATE_DIR");
    expect(env).not.toHaveProperty("BRANCH_GATEWAY_PASSWORD");
    expect(env.PATH).toBe("p");
    const port = await freePort();
    expect(FORBIDDEN_PORTS.has(port)).toBe(false);
  });
});

describe("ui tools: the Stop button ends control", () => {
  it("refuses every action once the owner pressed Stop", async () => {
    let state: "ok" | "stopped" = "ok";
    const page = { evaluate: async () => state } as unknown as Page;
    let closed = 0;
    const session = new UiSession(async (kind) => ({
      kind,
      page,
      describe: {},
      close: async () => void closed++,
    }));
    await expect(session.page()).resolves.toBe(page);
    state = "stopped";
    await expect(session.page()).rejects.toThrow(/pressed Stop/);
    await session.close();
    expect(closed).toBe(1);
  });

  it("finds a control by snapshot ref", () => {
    const seen: string[] = [];
    const page = { locator: (selector: string) => (seen.push(selector), {}) } as unknown as Page;
    locate(page, { ref: "e12" });
    locate(page, { ref: "ref=e3" });
    expect(seen).toEqual(["aria-ref=e12", "aria-ref=e3"]);
    expect(() => locate(page, {})).toThrow(/ref from ui_snapshot or a name/);
  });
});

// A real Chromium page over CDP: snapshot refs, click, type, the banner and Stop. CI's Linux job provides Chrome;
// locally set BRANCH_UI_E2E=1 (Edge on Windows, Chrome elsewhere), as the browser extension's chromium tests do.
describe.runIf(
  process.env.BRANCH_BROWSER_SNAPSHOT_E2E === "1" || process.env.BRANCH_UI_E2E === "1",
)("ui tools in a real browser", () => {
  it("snapshots, clicks and types by ref, and stops at the owner's Stop", async () => {
    const root = scratch();
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<!doctype html><title>t</title><button onclick="document.getElementById(\'out\').textContent=\'clicked \'+document.getElementById(\'q\').value">Usage</button><label>Search <input id="q"></label><p id="out"></p><button><svg width="10" height="10"></svg></button>',
    );
    const server = await serveWindow(root, await freePort());
    const browser = await launchBrowser(path.join(root, "profile"));
    try {
      const page = browser.pages()[0] ?? (await browser.newPage());
      const address = server.address();
      await page.goto(
        `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`,
      );
      const session = new UiSession(async (kind) => ({
        kind,
        page,
        describe: {},
        close: async () => undefined,
      }));
      await session.page();
      const snapshot = await page.ariaSnapshot({ mode: "ai" });
      expect(snapshot).toContain('button "Stop the agent controlling this window"');
      expect(unlabeledControls(snapshot).length).toBe(1);
      const ref = /textbox "Search" \[ref=(e\d+)\]/.exec(snapshot)?.[1];
      expect(ref).toBeTruthy();
      await locate(await session.page(), { ref }).fill("tokens");
      await locate(await session.page(), { name: "Usage" }).click();
      expect(await page.textContent("#out")).toBe("clicked tokens");
      await page.getByRole("button", { name: "Stop the agent controlling this window" }).click();
      await expect(session.page()).rejects.toThrow(/pressed Stop/);
      expect(
        await page.evaluate(
          `${CONTROL_BANNER_JS}({ id: "x", key: "branch-agent-control-stopped" })`,
        ),
      ).toBe("stopped");
    } finally {
      await browser.close();
      server.close();
    }
  }, 60_000);
});
