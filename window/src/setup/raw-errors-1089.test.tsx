// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): setup's More step showed the engine's raw words in "Bring your other assistant along"
// when looking for another assistant's memory failed (more-step.tsx message). It now reads plain; Advanced keeps the exact
// words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { MoreBody } from "./more-step";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|\/app\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "unknown method: config.patch",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, open '/home/me/.branch/branch.json'",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];

let root: Root | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });

async function bringLine(raw: string): Promise<string> {
  const request = vi.fn(async (method: string) => {
    if (method === "migrations.memory.plan") throw new Error(raw);
    if (method === "config.get") return { config: {}, hash: "h" };
    return {};
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MoreBody engine={engine} agentId="main" trunkName="Scout" />); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  const tile = host.querySelector(".bringPF18");
  expect(tile).not.toBeNull();
  const line = tile!.querySelector("p")?.textContent ?? "";
  expect(line).not.toBe("");
  expect(line).not.toContain("Looking for other assistants");
  return line;
}

describe("setup's More step never shows a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("%j", async (raw) => {
    expect(await bringLine(raw)).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await bringLine(FAILURES[1])).toContain("ECONNREFUSED");
  });
});
