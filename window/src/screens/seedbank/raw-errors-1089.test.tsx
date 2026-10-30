// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): adding a pasted team listed each Trunk the engine refused as "Not added: <raw engine
// error>" (TeamReview.tsx errorText). It now reads plain; Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { TeamFile } from "./team-markdown";
import { TeamReview } from "./TeamReview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|\/app\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "unknown method: config.patch",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, open '/home/me/.branch/branch.json'",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
const TEAM: TeamFile = { name: "Desk", description: "", removed: 0, bots: [{ name: "Scout", model: "", description: "", permissions: [], routines: [], instructions: "Help." }] };

let root: Root | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });

async function addFailing(raw: string): Promise<string> {
  const engine = { request: vi.fn(async () => { throw new Error(raw); }), onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<TeamReview team={TEAM} engine={engine} onClose={() => {}} onDone={() => {}} />); });
  const add = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Add team") as HTMLButtonElement;
  expect(add).toBeTruthy();
  await act(async () => { add.click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  const line = [...document.body.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => t.startsWith("Not added: "));
  expect(line).toBeTruthy();
  return line!;
}

describe("Team review never shows a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("%j", async (raw) => {
    expect(await addFailing(raw)).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await addFailing(FAILURES[1])).toContain("ECONNREFUSED");
  });
});
