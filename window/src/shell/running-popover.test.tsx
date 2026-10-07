// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Above } from "./Popover";
import { StatusBar, type StatusItem } from "./StatusBar";
import { StatusPopover, statusAnchor, type StatusContext } from "./StatusLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function ctx(request: (method: string, params?: unknown) => Promise<unknown>, working: StatusContext["working"]): StatusContext {
  return {
    session: { request, gatewayUrl: "ws://127.0.0.1:9", getSnapshot: () => ({ mainKey: "agent:a:main" }) },
    list: { refresh: async () => {}, getSnapshot: () => ({ rows: [] }) },
    limits: null,
    gateway: { health: { ok: true, durationMs: 4, checkedAt: 1 }, error: null, uptimeMs: 1000, connectedAt: Date.now() },
    update: null,
    version: "0.19.5",
    computerName: "",
    openRow: null,
    working,
    openSettings: () => {},
    openAutomations: () => {},
    openConversation: () => {},
    onWhatsNew: () => {},
    onReminded: () => {},
  } as unknown as StatusContext;
}

function Harness({ running, working, request }: { running: number; working: StatusContext["working"]; request: (method: string, params?: unknown) => Promise<unknown> }) {
  const [open, setOpen] = useState<StatusItem | null>(null);
  const [above, setAbove] = useState<Above>({ left: 10, right: 80, top: 700, align: "left" });
  return (
    <>
      <StatusBar connection="connected" gateway="on" machineName="Studio" roomUsed={null} running={running} version="0.19.5" usage={null} open={open}
        onItem={(item, e) => { setAbove(statusAnchor(e, item)); setOpen((cur) => (cur === item ? null : item)); }} />
      {open === "running" ? <StatusPopover item="running" above={above} onClose={() => setOpen(null)} ctx={ctx(request, working)} /> : null}
    </>
  );
}

async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

it("Clicking the running button with 0 running opens the popover with the empty line and Coming up.", async () => {
  const request = vi.fn(async () => ({ jobs: [{ name: "Morning brief", enabled: true, state: { nextRunAtMs: Date.now() + 30 * 60_000 } }] }));
  const host = await show(<Harness running={0} working={[]} request={request} />);
  expect(host.querySelector("[data-testid=pop-running]")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=sb-running]")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  const pop = host.querySelector("[data-testid=pop-running]");
  expect(pop).toBeTruthy();
  const text = pop?.textContent ?? "";
  expect(text).toContain("Coming up");
  expect(text).toContain("Morning brief");
  expect(text).toContain("Nothing is running.");
  expect(text.indexOf("Coming up")).toBeLessThan(text.indexOf("Nothing is running."));
  expect(text).toContain("Running in the background");
  expect(text.indexOf("Coming up")).toBeLessThan(text.indexOf("Running in the background"));
  expect(request).toHaveBeenCalledWith("cron.list", { limit: 200 });
});

it("Coming up is omitted when cron.list has no jobs.", async () => {
  const request = vi.fn(async () => ({ jobs: [] }));
  const host = await show(<Harness running={0} working={[]} request={request} />);
  await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=sb-running]")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  const pop = host.querySelector("[data-testid=pop-running]");
  expect(pop?.textContent).toContain("Nothing is running.");
  expect(pop?.textContent).not.toContain("Coming up");
});

it("With 2 working conversations, the popover lists both.", async () => {
  const request = vi.fn(async () => ({ jobs: [] }));
  const working = [
    { key: "agent:a:main", title: "Scout", line: "Reading invoices" },
    { key: "agent:b:main", title: "Ledger", line: "Working" },
  ];
  const host = await show(<Harness running={2} working={working} request={request} />);
  await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=sb-running]")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  const pop = host.querySelector("[data-testid=pop-running]");
  expect(pop?.textContent).toContain("Scout");
  expect(pop?.textContent).toContain("Reading invoices");
  expect(pop?.textContent).toContain("Ledger");
  expect(pop?.textContent).toContain("Working");
  expect(pop?.textContent).not.toContain("Nothing is running.");
  expect(pop?.textContent).not.toContain("Coming up");
});
