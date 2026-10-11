// The update bar the preload draws over the window (S3): a slim pill docked in the status bar's middle, so it covers no
// page content, that a waiting update lets the owner dismiss. Runs the compiled preload with a fake Electron and a tiny DOM; no Electron needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const preload = readFileSync(join(dist, "preload.js"), "utf8");

class FakeElement {
  constructor(doc, tag) {
    this.doc = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
    this.attributes = {}; this.dataset = {}; this.style = { cssText: "" }; this.listeners = {};
    this.id = ""; this.type = ""; this.title = ""; this.text = ""; this.height = 0;
  }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn(); }
  getBoundingClientRect() { return { height: this.height, width: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
}

function harness() {
  const storage = new Map();
  const handlers = {};
  const sent = [];
  const doc = {
    createElement: tag => new FakeElement(doc, tag),
    getElementById: id => [...doc.body.walk()].find(el => el.id === id) ?? null,
    querySelector: selector => {
      const testid = /^\[data-testid="([^"]+)"\]$/.exec(selector)?.[1];
      return testid ? [...doc.body.walk()].find(el => el.dataset.testid === testid) ?? null : null;
    },
    querySelectorAll: () => [],
  };
  doc.body = new FakeElement(doc, "body");
  const statusBar = doc.body.appendChild(new FakeElement(doc, "footer"));
  statusBar.dataset.testid = "statusbar";
  statusBar.height = 28;
  const win = { addEventListener() {}, dispatchEvent() { return true; } };
  const ipcRenderer = {
    sendSync: () => ({ gatewayUrl: "ws://127.0.0.1:1/", gatewayToken: "t" }),
    on: (channel, fn) => { handlers[channel] = fn; },
    send: (...args) => sent.push(args),
    invoke: async () => undefined,
    removeListener() {},
  };
  const electron = { contextBridge: { exposeInMainWorld() {} }, ipcRenderer };
  const module = { exports: {} };
  const context = vm.createContext({
    require: name => { if (name === "electron") return electron; throw new Error("unexpected require " + name); },
    module, exports: module.exports, window: win, document: doc, process: { platform: "linux" },
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} }, URL, Date, JSON, Math,
  });
  // Each run is a fresh page load in the same window: same session storage, new preload scope.
  const reload = () => vm.compileFunction(preload, ["require", "module", "exports"], { parsingContext: context, filename: "preload.js" })(context.require, module, module.exports);
  reload();
  const update = state => handlers["branch-desktop:engine-update"](undefined, state);
  const bar = () => doc.getElementById("branch-desktop-update");
  const byTestid = id => [...doc.body.walk()].find(el => el.dataset.testid === id) ?? null;
  return { update, bar, byTestid, sent, reload, statusBar };
}

test("the waiting update is a slim pill inside the status bar, not a bar over the page", () => {
  const h = harness();
  h.update("auto-wait");
  const bar = h.bar();
  assert.ok(bar, "the pill shows while an update waits");
  assert.match(bar.textContent, /Update ready, applying when your Trunks finish/);
  const css = bar.style.cssText;
  assert.match(css, /height:20px/, "slim: shorter than the 28px status bar");
  assert.match(css, /bottom:4px/, "centred inside the 28px status bar, not floating above it over the page");
  assert.match(css, /calc\(100vw - 420px\)/, "leaves the status bar's own items uncovered");
  assert.match(css, /border-radius:999px/);
  assert.ok(h.byTestid("desktop-update-restart"), "Update now stays available");
});

test("without a status bar (setup, connecting) the pill floats just above the bottom edge", () => {
  const h = harness();
  h.statusBar.remove();
  h.update("auto-wait");
  assert.match(h.bar().style.cssText, /bottom:16px/);
});

test("a waiting update can be dismissed, and stays dismissed when the state is re-sent or the page reloads", () => {
  const h = harness();
  h.update("auto-wait");
  const dismiss = h.byTestid("desktop-update-dismiss");
  assert.ok(dismiss, "the pill has a Dismiss button");
  assert.equal(dismiss.getAttribute("aria-label"), "Dismiss");
  dismiss.click();
  assert.equal(h.bar(), null);
  h.update("auto-wait");
  assert.equal(h.bar(), null, "re-sent auto-wait stays hidden");
  h.reload();
  h.update("auto-wait");
  assert.equal(h.bar(), null, "a reload re-sends auto-wait; it stays hidden");
});

test("a dismissed pill comes back when the update moves on, and Update now still restarts", () => {
  const h = harness();
  h.update("auto-wait");
  h.byTestid("desktop-update-dismiss").click();
  h.update("ready");
  assert.match(h.bar()?.textContent ?? "", /An update is ready/);
  h.byTestid("desktop-update-restart").click();
  assert.deepEqual(h.sent.at(-1), ["branch-desktop:restart-engine"]);
  h.update("updating");
  assert.match(h.bar()?.textContent ?? "", /Updating Branch/);
  assert.equal(h.byTestid("desktop-update-dismiss"), null, "an update in progress is not dismissable");
  h.update("updated");
  h.update("auto-wait");
  assert.ok(h.bar(), "after an update lands, the next waiting update shows again");
});
