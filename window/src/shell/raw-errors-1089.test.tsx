// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): Start over, Delete topic and Export put the engine's raw error under the
// buttons. They now read plain at Regular; Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { StartOverDialog } from "./ConversationDialogs";
import { DeleteTopicDialog } from "./TopicDialogs";
import { ExportDialog } from "../transcript-export/ExportDialog";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|EACCES|\/home\/|\/opt\/|TypeError|:\d+:\d+|INVALID_REQUEST/;
const FAILURES = [
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, open '/home/alex/.branch/workspace/notes.md'",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const failing = (message: string) => ({ features: { methods: [], events: [] }, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], onEvent: () => () => {}, request: vi.fn(async () => { throw new Error(message); }) }) as unknown as WindowEngine;

const press = async (label: RegExp) => { const b = [...document.querySelectorAll("button")].find((x) => label.test(x.textContent ?? "")); expect(b, String(label)).toBeTruthy(); await act(async () => b!.click()); await settle(); };
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent ?? "").join(" ");

describe("shared dialogs never show a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("Start over: %j", async (raw) => {
    await act(async () => root.render(<StartOverDialog trunkName="Scout" onStart={() => Promise.reject(new Error(raw))} onClose={() => {}} />));
    await press(/^Start over$/);
    expect(document.body.textContent).not.toMatch(RAW);
  });
  it.each(FAILURES)("Delete topic: %j", async (raw) => {
    await act(async () => root.render(<DeleteTopicDialog title="Plans" onCancel={() => {}} onDelete={() => Promise.reject(new Error(raw))} />));
    await press(/^Delete/);
    expect(alertText()).not.toBe("");
    expect(document.body.textContent).not.toMatch(RAW);
  });
  it.each(FAILURES)("Export: %j", async (raw) => {
    await act(async () => root.render(<ExportDialog engine={failing(raw)} sessionKey="agent:main:main" title="Notes" onClose={() => {}} />));
    await settle();
    await press(/^(Export|Save|Download)/);
    expect(document.body.textContent).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<DeleteTopicDialog title="Plans" onCancel={() => {}} onDelete={() => Promise.reject(new Error(FAILURES[0]))} />));
    await press(/^Delete/);
    expect(alertText()).toContain("ECONNREFUSED");
  });
});
