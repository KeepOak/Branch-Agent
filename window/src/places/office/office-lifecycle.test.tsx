// @vitest-environment jsdom
// Grove's office is mounted once and torn down after React's commit (QA 1014 item 6: closing Grove threw "synchronously unmount a root
// while React was already rendering" on every close, and the office was rebuilt whenever the parent re-rendered).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OfficePlace } from "./index";
import { setOfficeKeyRoot } from "./pixel/webview-ui/src/branch/keyScope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { mounts, destroys } = vi.hoisted(() => ({ mounts: [] as unknown[], destroys: [] as unknown[] }));
vi.mock("./pixel/webview-ui/src/branch/mount", () => ({
  Storage: class { constructor(_initial: unknown, _save: unknown) {} },
  mountPixelOffice: (host: HTMLElement) => {
    mounts.push(host);
    return { update: () => undefined, setReducedMotion: () => undefined, destroy: () => { destroys.push(host); host.replaceChildren(); } };
  },
}));

afterEach(async () => {
  // Let a deferred teardown from the test that just ended run now, so it cannot land in the next test's record.
  await new Promise(r => setTimeout(r, 0));
  setOfficeKeyRoot(null); document.body.replaceChildren(); mounts.length = 0; destroys.length = 0;
});

const engine = {
  request: vi.fn(async (method: string) => method === "agents.list" ? { agents: [] }
    : method === "sessions.list" ? { sessions: [] }
    : method === "contacts.list" ? { contacts: [] }
    : method === "users.prefs.get" ? { status: "ok", entries: {} } : {}),
  onEvent: () => () => undefined,
} as unknown as WindowEngine;

it("mounts the office once, and keeps it when the parent passes a new openConversation", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  const render = (open: () => void) => act(async () => { root.render(<OfficePlace engine={engine} facts={{ running: 0, waiting: 0 }} level="regular" openConversation={open} openPlace={() => undefined} />); });
  await render(() => undefined);
  await act(async () => { await vi.waitFor(() => expect(mounts).toHaveLength(1)); });
  await render(() => undefined);
  await render(() => undefined);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(mounts).toHaveLength(1);
  expect(destroys).toHaveLength(0);
  await act(async () => root.unmount());
});

it("tears the office down after the commit, not inside it, when Grove closes", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<OfficePlace engine={engine} facts={{ running: 0, waiting: 0 }} level="regular" openConversation={() => undefined} openPlace={() => undefined} />); });
  await act(async () => { await vi.waitFor(() => expect(mounts).toHaveLength(1)); });
  // A real unmount: React is not rendering here, so this is the call that threw before the fix.
  root.unmount();
  expect(destroys).toHaveLength(0);
  await new Promise(r => setTimeout(r, 0));
  expect(destroys).toHaveLength(1);
});
