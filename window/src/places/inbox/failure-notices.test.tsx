// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadNeeds, type Needs } from "./data";
import { NeedsYou } from "./NeedsYou";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span>{label}</span> }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });

const error = "All models failed (4). Re-authenticate with: branch --profile dev models auth login";
const failedRow = { key: "agent:new-trunk-2:main", agentId: "new-trunk-2", status: "failed", lastRunError: error, lastRunId: "run-1", updatedAt: Date.now() };
function engineWith(row = failedRow, auth = { providers: [{ provider: "openai", status: "expired" }] }) {
  const request = vi.fn(async (method: string) => {
    if (method === "sessions.list") return { sessions: [row] };
    if (method === "agents.list") return { defaultId: "new-trunk-2", mainKey: "main", agents: [{ id: "new-trunk-2", identity: { name: "New Trunk 2" } }] };
    if (method === "models.authStatus") return auth;
    return {};
  });
  return { engine: { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine, request };
}
async function render(data: Needs, engine: WindowEngine) {
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const openSettings = vi.fn();
  await act(async () => root!.render(<NeedsYou data={data} engine={engine} busy={false} act={async () => true} level="regular" loading={false} openConversation={() => {}} openPlace={() => {}} openSettings={openSettings} />));
  return { host, openSettings };
}
const failureCard = (host: ParentNode) => [...host.querySelectorAll(".ib-card")].find(card => card.querySelector("b")?.textContent?.includes("couldn't"));

it("renders an auth failure in plain words with a sign-in action and no CLI command", async () => {
  const { engine } = engineWith();
  const { host, openSettings } = await render(await loadNeeds(engine), engine);
  const card = host.querySelector(".ib-card")!;
  expect(card.querySelector("b")?.textContent).toBe("New Trunk 2 couldn't reach a model: its sign-in had expired.");
  expect(card.querySelector("small")?.textContent).toBe("In its main chat.");
  expect(card.textContent).not.toMatch(/Untitled conversation|branch --profile|models auth login/);
  await act(async () => (card.querySelector("button.btn") as HTMLButtonElement).click());
  expect(openSettings).toHaveBeenCalledWith("accounts");
});

it("removes a failed run after a successful run or recovered sign-in", async () => {
  const { engine } = engineWith();
  const recovered = await loadNeeds(engineWith(failedRow, { providers: [{ provider: "openai", status: "ok" }] }).engine);
  expect(failureCard((await render(recovered, engine)).host)).toBeUndefined();
  await act(async () => root?.unmount()); root = undefined;
  const successful = await loadNeeds(engineWith({ ...failedRow, status: "done", lastRunId: "run-2" }).engine);
  expect(failureCard((await render(successful, engine)).host)).toBeUndefined();
});

it("keeps a dismissed failure gone across remounts, but shows a later failure", async () => {
  const { engine } = engineWith();
  const data = await loadNeeds(engine);
  const { host } = await render(data, engine);
  await act(async () => (host.querySelector('[aria-label="Dismiss New Trunk 2 failure"]') as HTMLButtonElement).click());
  expect(failureCard(host)).toBeUndefined();
  await act(async () => root?.unmount()); root = undefined;
  expect(failureCard((await render(data, engine)).host)).toBeUndefined();
  await act(async () => root?.unmount()); root = undefined;
  const later = await loadNeeds(engineWith({ ...failedRow, lastRunId: "run-3" }).engine);
  expect(failureCard((await render(later, engine)).host)).toBeDefined();
});
