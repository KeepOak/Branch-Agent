// @vitest-environment jsdom
// Computer stage Stop and hold failures: one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ComputerStage } from "./ComputerStage";

const viewer = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./desktop-client", () => ({
  DesktopClient: class { connect = viewer.connect; },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  viewer.connect.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

const engineOf = (request: WindowEngine["request"]): WindowEngine => ({
  request, sessionKey: "agent:scout:one", scopes: ["operator.admin"], onEvent: () => () => {},
});

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

const draw = (request: WindowEngine["request"]) =>
  act(async () => root.render(
    <ComputerStage engine={engineOf(request)} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" running onMode={() => undefined} onClose={() => undefined} onChooseComputer={() => undefined} />,
  ));

describe("the computer stage never shows a raw engine error at Regular", () => {
  it("names a failed Stop in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.abort") throw new Error(ENGINE);
      return { session: { key: "agent:scout:one" } };
    });
    await draw(request as WindowEngine["request"]);
    await flush();
    const stop = [...host.querySelectorAll("button")].find((b) => b.textContent === "Stop");
    expect(stop && !stop.disabled).toBe(true);
    await act(async () => stop!.click());
    await flush();
    const alert = host.querySelector(".stage-error-st[role='alert']")?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
  });

  it("keeps a hold failure as one plain sentence", async () => {
    viewer.connect.mockImplementation(async (options: { onConnect: () => void }) => { options.onConnect(); return { disconnect: vi.fn() }; });
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.describe") return { session: { key: "agent:scout:one", placement: { state: "active", environmentId: "worker-one" }, goal: { id: "g1", status: "active" }, agentId: "scout" } };
      if (method === "environments.status") return { id: "worker-one", label: "Private computer 1", desktop: true, status: "available" };
      if (method === "environments.list") return { environments: [{ id: "worker-one", label: "Private computer 1", desktop: true, status: "available" }] };
      if (method === "desktop.observe") return { wsPath: "/desktop/one", control: true, transport: "rfb", expiresAtMs: 1000 };
      if (method === "sessions.goal.update") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(
      <ComputerStage engine={engineOf(request as WindowEngine["request"])} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" running initialControl onMode={() => undefined} onClose={() => undefined} onChooseComputer={() => undefined} />,
    ));
    await flush();
    const alert = [...host.querySelectorAll(".stage-error-st[role='alert']")].map((n) => n.textContent).join(" ");
    expect(alert).toContain("Couldn't pause it. It may keep working while you drive.");
    expect(alert).not.toMatch(RAW);
  });

  it("keeps the exact Stop words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.abort") throw new Error(ENGINE);
      return { session: { key: "agent:scout:one" } };
    });
    await draw(request as WindowEngine["request"]);
    await flush();
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Stop")!.click());
    await flush();
    expect(host.querySelector(".stage-error-st[role='alert']")?.textContent).toBe(ENGINE);
  });
});
