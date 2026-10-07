// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewTab, readPortals, usePortals } from "./PreviewTab";
import type { WindowEngine } from "../../connect/engine";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const portal = (id: string, title: string, port: number, createdAtMs: number, url = `http://127.0.0.1:4${port}/?t=x`) =>
  ({ id, title, port, listenPort: 40000 + port, publicUrl: `http://127.0.0.1:4${port}`, url, createdAtMs });

function engineWith(request: ReturnType<typeof vi.fn>) {
  let listener: Parameters<WindowEngine["onEvent"]>[0] | undefined;
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", scopes: [], request,
    onEvent: (fn: typeof listener) => { listener = fn; return () => { listener = undefined; }; },
  } as unknown as WindowEngine;
  return { engine, emit: (event: string) => listener?.({ event, payload: {} }) };
}

function Host({ engine, toast }: { engine: WindowEngine; toast: (m: string) => void }) {
  const { portals, error } = usePortals(engine);
  const [fail, setFail] = useState("");
  return <>{fail ? <p data-testid="fail">{fail}</p> : null}<PreviewTab engine={engine} name="Scout" portals={portals} error={error} onError={setFail} toast={toast} /></>;
}

async function mount(engine: WindowEngine, toast = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Host engine={engine} toast={toast} />));
  return container;
}

it("reads portals newest first and keeps the access address only when the engine gives it", () => {
  const list = readPortals({ portals: [portal("a", "Old", 5173, 1), { ...portal("b", "New", 8080, 2), url: undefined }, { id: "", port: 1 }] });
  expect(list.map((p) => p.title)).toEqual(["New", "Old"]);
  expect(list[0]!.url).toBe("");
});

it("asks the Trunk for a preview when none is open", async () => {
  const { engine } = engineWith(vi.fn().mockResolvedValue({ portals: [] }));
  const container = await mount(engine);
  expect(container.textContent).toContain("Nothing to preview yet. Ask Scout:");
  const heard = vi.fn();
  window.addEventListener("branch:compose", heard);
  await act(async () => container.querySelector<HTMLButtonElement>(".chip6-pn")!.click());
  window.removeEventListener("branch:compose", heard);
  expect((heard.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sessionKey: "agent:scout:main", text: "Show me in a preview." });
});

it("shows the newest preview in a frame, switches rows, and closes one through the engine", async () => {
  const request = vi.fn(async (method: string) => (method === "portal.list" ? { portals: [portal("a", "Booking sync", 8080, 1), portal("b", "Trip planner", 5173, 2)] } : { closed: true }));
  const { engine, emit } = engineWith(request);
  const toast = vi.fn();
  const container = await mount(engine, toast);
  expect(container.querySelector("iframe")!.title).toBe("Trip planner preview");
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".pv-pick-pn")][1]!.click());
  expect(container.querySelector("iframe")!.title).toBe("Booking sync preview");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Trip planner"]')!.click());
  expect(request).toHaveBeenCalledWith("portal.close", { id: "b" });
  expect(toast).toHaveBeenCalledWith("Closed the Trip planner preview. The app keeps running.");
  await act(async () => emit("portal.changed"));
  expect(request.mock.calls.filter(([m]) => m === "portal.list")).toHaveLength(2);
});
