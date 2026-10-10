/** Real isolated Chromium proof for the portable pinned minimum-jerk driver. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBrowserTool } from "../browser-tool.js";
import { browserAct } from "./client-actions.js";
import { resolveBrowserConfig } from "./config.js";
import { getPlaywrightCore } from "./playwright-core.runtime.js";
import { humanClickViaPlaywright } from "./pw-pointer-humanized.js";
import { closePlaywrightBrowserConnection } from "./pw-session.js";
import { executeActViaPlaywright } from "./pw-tools-core.interactions.execution.js";
import { snapshotRoleViaPlaywright } from "./pw-tools-core.snapshot.js";
import { registerBrowserRoutes } from "./routes/index.js";
import { createBrowserRuntimeState, stopBrowserBridgeRuntime } from "./runtime-lifecycle.js";
import { createBrowserRouteContext } from "./server-context.js";
import { installBrowserCommonMiddleware } from "./server-middleware.js";
import { getFreePort } from "./test-port.js";

type InputRecord = {
  type: string;
  x: number;
  y: number;
  target: string;
  buttons: number;
  trusted: boolean;
};
type FixtureState = { events: InputRecord[]; clicked: string[]; mode: string; changed: boolean };
type FixtureWindow = typeof globalThis & { pointerFixture?: FixtureState };

const FIXTURE = `<style>
button { position:absolute; width:100px; height:40px; }
#target { left:400px; top:250px; } #decoy { left:550px; top:250px; }
</style><button id="target">Target</button><button id="decoy">Decoy</button><script>
window.pointerFixture = { events: [], clicked: [], mode: '', changed: false };
for (const type of ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
 document.addEventListener(type, e => {
  const state = window.pointerFixture;
  const record = { type, x: e.clientX, y: e.clientY, target: e.target.id || '', buttons: e.buttons, trusted: e.isTrusted };
  state.events.push(record);
  if (type === 'click') state.clicked.push(record.target);
  const moves = state.events.filter(v => v.type === 'mousemove').length;
  if (!state.changed && type === 'mousemove' && moves >= 8) {
   if (state.mode === 'move') { document.querySelector('#target').style.left = '800px'; state.changed = true; }
   if (state.mode === 'detach') { document.querySelector('#target').remove(); state.changed = true; }
  }
  if (window.notifyInput) void window.notifyInput(record);
 }, true);
}
</script>`;

function launchEnvironment() {
  const env = { ...process.env };
  if (process.platform === "win32" && env.HOMEDRIVE && env.HOMEPATH) {
    env.USERPROFILE = path.join(env.HOMEDRIVE, env.HOMEPATH);
    env.HOME = env.USERPROFILE;
  }
  return env;
}

function fixtureConfig(cdpUrl: string, port: number) {
  return resolveBrowserConfig({
    evaluateEnabled: false,
    defaultProfile: "fixture",
    profiles: {
      fixture: { cdpUrl, attachOnly: true, color: "#112233" },
      lightweight: { engine: "lightpanda", cdpUrl: `ws://127.0.0.1:${port}/`, attachOnly: true },
    },
  });
}

async function removeFixtureProfile(profileDir: string | undefined, artifactRoot: string) {
  if (!profileDir) {
    return;
  }
  const resolved = path.resolve(profileDir);
  if (!resolved.startsWith(artifactRoot + path.sep)) {
    throw new Error("Unsafe fixture cleanup");
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function startFixtureService(cdpUrl: string) {
  const app = express();
  installBrowserCommonMiddleware(app);
  let blockedRequests = 0;
  app.get("/blocked", (_req, res) => {
    blockedRequests++;
    res.send("blocked fixture");
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected isolated port");
  }
  const state = await createBrowserRuntimeState({
    server,
    port: address.port,
    resolved: fixtureConfig(cdpUrl, address.port),
  });
  registerBrowserRoutes(
    app,
    createBrowserRouteContext({ getState: () => state, refreshConfigFromDisk: false }),
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    blockedRequests: () => blockedRequests,
    stop: async () => {
      server.closeAllConnections();
      await stopBrowserBridgeRuntime({
        current: state,
        getState: () => state,
        clearState: () => {},
        closeServer: true,
        onWarn: () => {},
      });
    },
  };
}

function expectLanding(state: FixtureState, x: number, y: number) {
  expect(state.clicked).toEqual(["target"]);
  expect(state.events.every((event) => event.trusted)).toBe(true);
  const moves = state.events.filter((e) => e.type === "mousemove");
  expect(moves.length).toBeGreaterThan(8);
  expect(moves.some((e) => e.x > 4 && e.x < x && e.y < y)).toBe(true);
  const click = state.events.find((e) => e.type === "click")!;
  expect(click.x).toBeGreaterThanOrEqual(x);
  expect(click.x).toBeLessThanOrEqual(x + 100);
  expect(click.y).toBeGreaterThanOrEqual(y);
  expect(click.y).toBeLessThanOrEqual(y + 40);
  expect(state.events.filter((e) => e.type === "mousedown")).toHaveLength(1);
  expect(state.events.filter((e) => e.type === "mouseup")).toHaveLength(1);
}

async function readFixtureState(page: Page): Promise<FixtureState> {
  for (const frame of page.frames()) {
    const state = await frame.evaluate(() =>
      document.querySelector("#decoy") ? (window as FixtureWindow).pointerFixture : undefined,
    );
    if (state) {
      return state;
    }
  }
  throw new Error("No active pointer fixture document");
}

describe.runIf(process.env.BRANCH_BROWSER_SNAPSHOT_E2E === "1")("native humanized pointer", () => {
  let browser: BrowserContext;
  let page: Page;
  let profileDir: string;
  let artifactRoot: string;
  let target: { cdpUrl: string; targetId: string };
  let service: Awaited<ReturnType<typeof startFixtureService>>;
  let onInput: ((event: InputRecord) => void) | undefined;
  const evidence: Array<{ test: string | undefined; input: FixtureState | { error: string } }> = [];
  const readState = () => readFixtureState(page);

  beforeAll(async () => {
    artifactRoot = path.resolve(
      process.env.BRANCH_TEST_ARTIFACT_DIR ?? path.join(os.tmpdir(), "Codex-session-files"),
    );
    await mkdir(artifactRoot, { recursive: true });
    profileDir = await mkdtemp(path.join(artifactRoot, "human-pointer-profile-"));
    const port = await getFreePort();
    browser = await getPlaywrightCore().chromium.launchPersistentContext(profileDir, {
      headless: true,
      timeout: 60_000,
      viewport: { width: 1800, height: 1000 },
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [`--remote-debugging-port=${port}`],
      env: launchEnvironment(),
    });
    page = browser.pages()[0] ?? (await browser.newPage());
    await page.exposeFunction("notifyInput", (event: InputRecord) => onInput?.(event));
    const session = await browser.newCDPSession(page);
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.detach();
    target = { cdpUrl: `http://127.0.0.1:${port}`, targetId: targetInfo.targetId };
    service = await startFixtureService(target.cdpUrl);
  });

  afterAll(async () => {
    try {
      if (profileDir) {
        await writeFile(
          path.join(artifactRoot, `human-pointer-native-${path.basename(profileDir)}.json`),
          JSON.stringify({ target, evidence }, null, 2),
        );
      }
      // All action effects are joined. Close only our launcher-owned browser first,
      // so fixture CDP connections cannot hold the bridge drain open.
      await browser?.close();
      await closePlaywrightBrowserConnection({ cdpUrl: target?.cdpUrl });
      await service?.stop();
    } finally {
      await browser?.close();
      await removeFixtureProfile(profileDir, artifactRoot);
    }
  });

  afterEach(async () => {
    const input = await readState().catch((error) => ({ error: String(error) }));
    evidence.push({ test: expect.getState().currentTestName, input });
  });

  beforeEach(async () => {
    onInput = undefined;
    await page.goto("about:blank");
    await page.setContent(FIXTURE);
  });

  it("follows a multi-step path and clicks the target rather than a neighboring decoy", async () => {
    await humanClickViaPlaywright({ ...target, selector: "#target" });
    expectLanding(await readState(), 400, 250);
  });

  it.each([
    [700, 20],
    [40, 500],
    [1600, 850],
  ])("lands on native target at (%i,%i)", async (x, y) => {
    await page.locator("#target").evaluate(
      (el, point) => {
        (el as HTMLElement).style.left = `${point.x}px`;
        (el as HTMLElement).style.top = `${point.y}px`;
      },
      { x, y },
    );
    await humanClickViaPlaywright({ ...target, selector: "#target" });
    expectLanding(await readState(), x, y);
  });

  it("uses a real scoped frame ref with page-space pointer coordinates", async () => {
    await page.setContent(
      '<iframe id="frame" style="position:absolute;left:200px;top:100px;width:700px;height:500px"></iframe>',
    );
    const frame = page.frames().find((f) => f.parentFrame())!;
    await frame.setContent(FIXTURE);
    const snapshot = await snapshotRoleViaPlaywright({ ...target, frameSelector: "#frame" });
    const ref = Object.entries(snapshot.refs).find(([, entry]) => entry.name === "Target")![0];
    await humanClickViaPlaywright({ ...target, ref });
    const state = await frame.evaluate(() => (window as FixtureWindow).pointerFixture);
    if (!state) {
      throw new Error("Scoped pointer fixture must be initialized");
    }
    expectLanding(state, 400, 250);
  });

  it.each(["move", "detach"])("rejects a target that changes during motion (%s)", async (mode) => {
    await page.evaluate((value) => {
      const fixture = (window as FixtureWindow).pointerFixture;
      if (!fixture) {
        throw new Error("Pointer fixture must be initialized");
      }
      fixture.mode = value;
    }, mode);
    await expect(humanClickViaPlaywright({ ...target, selector: "#target" })).rejects.toThrow(
      "moved or detached",
    );
    const state = await readState();
    expect(state.changed).toBe(true);
    expect(state.clicked).toEqual([]);
    expect(state.events.filter((e) => e.type === "mousedown")).toEqual([]);
  });

  it("stops motion on real event-triggered cancellation", async () => {
    const controller = new AbortController();
    let moves = 0;
    onInput = (event) => {
      if (event.type === "mousemove" && ++moves === 6) {
        controller.abort(new Error("fixture cancelled"));
      }
    };
    await expect(
      humanClickViaPlaywright({ ...target, selector: "#target", signal: controller.signal }),
    ).rejects.toThrow("fixture cancelled");
    const state = await readState();
    expect(state.events.filter((e) => e.type === "mousemove")).toHaveLength(moves);
    expect(state.clicked).toEqual([]);
    await page.waitForTimeout(100);
    expect(await readState()).toEqual(state);
  });

  it("can interrupt between the six short-distance adjustment steps", async () => {
    await page.locator("#target").evaluate((el) => {
      Object.assign((el as HTMLElement).style, {
        left: "8px",
        top: "8px",
        width: "4px",
        height: "4px",
      });
    });
    const controller = new AbortController();
    let moves = 0;
    onInput = (event) => {
      if (event.type === "mousemove" && ++moves === 3) {
        controller.abort(new Error("fixture adjustment cancelled"));
      }
    };
    await expect(
      humanClickViaPlaywright({ ...target, selector: "#target", signal: controller.signal }),
    ).rejects.toThrow("fixture adjustment cancelled");
    const state = await readState();
    expect(state.events.filter((e) => e.type === "mousemove").length).toBeLessThan(7);
    expect(state.clicked).toEqual([]);
    await page.waitForTimeout(100);
    expect(await readState()).toEqual(state);
  });

  it("rechecks native authority during motion", async () => {
    let current = true;
    let moves = 0;
    onInput = (event) => {
      if (event.type === "mousemove" && ++moves === 6) {
        current = false;
      }
    };
    await expect(
      humanClickViaPlaywright({
        ...target,
        selector: "#target",
        assertCurrent: () => {
          if (!current) {
            throw new Error("fixture revoked");
          }
        },
      }),
    ).rejects.toThrow("fixture revoked");
    expect((await readState()).clicked).toEqual([]);
  });

  it("releases the held button when cancellation follows native mouse-down", async () => {
    const controller = new AbortController();
    onInput = (event) => {
      if (event.type === "mousedown") {
        controller.abort(new Error("fixture button cancelled"));
      }
    };
    await expect(
      humanClickViaPlaywright({ ...target, selector: "#target", signal: controller.signal }),
    ).rejects.toThrow("fixture button cancelled");
    const events = (await readState()).events;
    expect(events.filter((e) => e.type === "mousedown")).toHaveLength(1);
    expect(events.filter((e) => e.type === "mouseup")).toHaveLength(1);
    expect(events.find((e) => e.type === "mouseup")?.buttons).toBe(0);
  });

  it("refuses to click a target covered by a different control", async () => {
    await page.locator("#decoy").evaluate((el) => {
      (el as HTMLElement).style.left = "400px";
    });
    await expect(
      humanClickViaPlaywright({ ...target, selector: "#target", timeoutMs: 4_000 }),
    ).rejects.toThrow();
    expect((await readState()).clicked).toEqual([]);
  });

  it("executes the default tool through actual snapshot, client, guarded route and native batch", async () => {
    const tool = createBrowserTool({ sandboxBridgeUrl: service.baseUrl, allowHostControl: false });
    const scope = { target: "sandbox", targetId: target.targetId };
    const snapshot = await tool.execute("pointer-snapshot", { ...scope, action: "snapshot" });
    const text = snapshot.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    const ref = /button "Target" \[ref=([^\]]+)\]/.exec(text)![1];
    const result = await tool.execute("pointer-click", {
      ...scope,
      action: "act",
      kind: "humanClick",
      ref,
    });
    expect(result.details).toHaveProperty("targetId", target.targetId);
    expectLanding(await readState(), 400, 250);
    const batch = await tool.execute("pointer-batch", {
      ...scope,
      action: "act",
      kind: "batch",
      actions: [
        { kind: "humanClick", ref },
        { kind: "click", ref },
      ],
    });
    expect(batch.details).toMatchObject({ results: [{ ok: true }, { ok: true }] });
    expect((await readState()).clicked).toEqual(["target", "target", "target"]);
  });

  it("preserves ordinary native right-click and double-click behavior", async () => {
    await browserAct(service.baseUrl, {
      ...target,
      kind: "click",
      selector: "#target",
      button: "right",
    });
    expect(
      (await readState()).events.some((e) => e.type === "contextmenu" && e.target === "target"),
    ).toBe(true);
    await browserAct(service.baseUrl, {
      ...target,
      kind: "click",
      selector: "#target",
      doubleClick: true,
    });
    expect(
      (await readState()).events.some((e) => e.type === "dblclick" && e.target === "target"),
    ).toBe(true);
  });

  it("rejects a direct Lightpanda request before input", async () => {
    await expect(
      browserAct(service.baseUrl, { kind: "humanClick", ref: "e1" }, { profile: "lightweight" }),
    ).rejects.toThrow("does not support");
    expect((await readState()).events).toEqual([]);
  });

  async function expectPrivateHumanClickRefused() {
    await expect(
      executeActViaPlaywright({
        ...target,
        action: { kind: "humanClick", selector: "#target" },
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: false },
      }),
    ).rejects.toThrow(/Blocked hostname or private\/internal\/special-use IP address/);
    expect(service.blockedRequests()).toBe(0);
  }

  it("retains the native navigation policy on a humanClick-triggered request", async () => {
    await page.locator("#target").evaluate(
      (el, url) =>
        el.addEventListener("click", () => {
          location.href = url;
        }),
      `${service.baseUrl}/blocked`,
    );
    await expectPrivateHumanClickRefused();
  });

  it("completes a humanClick when the target swallows the bubble click", async () => {
    await page.locator("#target").evaluate((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      });
    });
    await humanClickViaPlaywright({ ...target, selector: "#target" });
    expectLanding(await readState(), 400, 250);
  });

  it("completes a swallowed click and still refuses a private navigation", async () => {
    await page.locator("#target").evaluate((el, url) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        location.href = url;
      });
    }, `${service.baseUrl}/blocked`);
    await expectPrivateHumanClickRefused();
  });

  it("refuses a private navigation after capture-phase stopPropagation", async () => {
    await page.evaluate((url) => {
      document.addEventListener(
        "click",
        (event) => {
          location.href = url;
          event.stopPropagation();
        },
        true,
      );
    }, `${service.baseUrl}/blocked`);
    await expectPrivateHumanClickRefused();
  });

  it("refuses a private navigation when a capture listener calls stopImmediatePropagation", async () => {
    await page.evaluate((url) => {
      document.addEventListener(
        "click",
        (event) => {
          location.href = url;
          event.stopImmediatePropagation();
        },
        true,
      );
    }, `${service.baseUrl}/blocked`);
    await expectPrivateHumanClickRefused();
  });

  it("refuses a private navigation when the target is removed on mousedown", async () => {
    await page.locator("#target").evaluate((el, url) => {
      el.addEventListener("mousedown", () => {
        location.href = url;
        el.remove();
      });
    }, `${service.baseUrl}/blocked`);
    await expectPrivateHumanClickRefused();
  });
});
