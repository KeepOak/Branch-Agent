// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComputerStage } from "./ComputerStage";
import { StageConversation } from "./StageConversation";
import type { WindowEngine } from "../connect/engine";
const viewer = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./desktop-client", () => ({
  DesktopClient: class {
    connect = viewer.connect;
  },
}));
let root: Root | undefined;
let container: HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  viewer.connect.mockReset();
  document.body.innerHTML = "";
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const engine = (request: WindowEngine["request"], key = "agent:scout:one"): WindowEngine => ({
  request,
  sessionKey: key,
  scopes: ["operator.admin"],
  onEvent: () => () => {},
});
const render = async (owner: WindowEngine, mode: "Computer" | "Browser" = "Computer") => {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <ComputerStage
        engine={owner}
        gatewayUrl="ws://gateway.invalid"
        name="Scout"
        mode={mode}
        onMode={() => {}}
        onClose={() => {}}
        onChooseComputer={() => {}}
      />,
    );
  });
};
const placed = {
  session: { key: "agent:scout:one", placement: { state: "active", environmentId: "worker-one" } },
};
const environment = {
  id: "worker-one",
  label: "Private computer 1",
  desktop: true,
  status: "available",
};
const observed = { wsPath: "/desktop/one", control: false, transport: "rfb", expiresAtMs: 1000 };
describe("conversation computer lifecycle", () => {
  it("keeps the main composer in the stage column at 900 px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<StageConversation
      thread={<div className="thread-wrap" />}
      stage={<ComputerStage engine={engine(vi.fn(async () => ({ session: { key: "agent:scout:one" } })) as WindowEngine["request"])} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />}
      composer={<div className="c-wrap"><form className="composer"><textarea aria-label="Message" /></form></div>}
    />));
    expect(container.querySelector(".conversation-column > .computer-stage")).not.toBeNull();
    expect(container.querySelector(".conversation-column > .c-wrap .composer textarea")).not.toBeNull();
  });
  it.each(["Computer", "Browser"] as const)("shows only the main composer beside the %s stage", async (mode) => {
    const request = vi.fn(async () => ({ session: { key: "agent:scout:one" } }));
    await render(engine(request as WindowEngine["request"]), mode);
    await flush();
    expect(container.querySelector(".st7-dock")).toBeNull();
    expect(container.querySelector(".dk7-in")).toBeNull();
    expect(container.querySelector('[aria-label="Show the conversation"]')).toBeNull();
  });
  it("shows placement lookup failures and retries instead of claiming no placement", async () => {
    let failed = true;
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.describe" && failed) throw new Error("Placement unavailable");
      return method === "sessions.describe" ? { session: { key: "agent:scout:one" } } : {};
    });
    await render(engine(request as WindowEngine["request"]));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Placement unavailable");
    expect(container.textContent).not.toContain("It can't see a screen");
    failed = false;
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again")!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("It can't see a screen");
  });
  it("keeps a known conversation placement when the computer list fails", async () => {
    viewer.connect.mockImplementation(async (options: any) => { options.onConnect(); return { disconnect: vi.fn() }; });
    const request = vi.fn(async (method: string) => {
      if (method === "environments.list") throw new Error("Computer list unavailable");
      return method === "sessions.describe" ? placed : method === "environments.status" ? environment : method === "desktop.observe" ? observed : {};
    });
    await render(engine(request as WindowEngine["request"]));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Computer list unavailable");
    expect(viewer.connect).toHaveBeenCalled();
    expect(container.textContent).toContain("Take over");
  });
  it("falls back to the gateway when this conversation has no placement and gateway has a desktop", async () => {
    const gatewayEnv = { id: "gateway", label: "", desktop: true, status: "available", platform: "linux" };
    viewer.connect.mockImplementation(async (options: any) => { options.onConnect(); return { disconnect: vi.fn() }; });
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.describe") return { session: { key: "agent:scout:one" } };
      if (method === "environments.list") return { environments: [gatewayEnv], profiles: [] };
      if (method === "environments.status") return gatewayEnv;
      if (method === "desktop.observe") return { ...observed, wsPath: "/desktop/gateway" };
      return {};
    });
    await render(engine(request as any));
    await flush();
    expect(request.mock.calls.map((c: unknown[]) => c[0])).toContain("desktop.observe");
    expect(request.mock.calls.map((c: unknown[]) => c[0])).toContain("environments.status");
    expect(container.textContent).toContain("This computer (watching)");
    expect(viewer.connect).toHaveBeenCalled();
  });
  it("shows empty state when no placement and gateway has no desktop", async () => {
    const gatewayEnv = { id: "gateway", label: "", desktop: false, status: "available", platform: "linux" };
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.describe") return { session: { key: "agent:scout:one" } };
      if (method === "environments.list") return { environments: [gatewayEnv], profiles: [] };
      return {};
    });
    await render(engine(request as any));
    await flush();
    expect(request.mock.calls.map((c: unknown[]) => c[0])).not.toContain("desktop.observe");
    expect(container.textContent).toContain("It can't see a screen");
    expect(container.textContent).not.toContain("watching");
    expect(viewer.connect).not.toHaveBeenCalled();
  });
  it("releases a late observe response after closing without opening its socket", async () => {
    let resolve!: (value: any) => void;
    const waiting = new Promise((resolve_) => {
      resolve = resolve_;
    });
    const request = vi.fn(async (method: string) =>
      method === "sessions.describe"
        ? placed
        : method === "environments.status"
          ? environment
          : method === "desktop.observe"
            ? waiting
            : {},
    );
    await render(engine(request as any));
    await flush();
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () => {
      resolve(observed);
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith("desktop.release", { wsPath: "/desktop/one" });
    expect(viewer.connect).not.toHaveBeenCalled();
  });
  it("starts view-only and retires the previous viewer on session change", async () => {
    const disconnect = vi.fn();
    viewer.connect.mockImplementation(async (options: any) => {
      options.onConnect();
      return { disconnect };
    });
    const request = vi.fn(async (method: string) =>
      method === "sessions.describe"
        ? placed
        : method === "environments.status"
          ? environment
          : method === "desktop.observe"
            ? observed
            : {},
    );
    await render(engine(request as any));
    await flush();
    expect(viewer.connect.mock.calls[0][0].viewOnly).toBe(true);
    expect(container.textContent).toContain("Take over");
    expect(container.textContent).toContain("Idle");
    await render(
      engine(vi.fn(async () => ({ session: { key: "agent:ada:two" } })) as any, "agent:ada:two"),
    );
    await flush();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("desktop.release", { wsPath: "/desktop/one" });
    expect(container.textContent).not.toContain("Private computer 1");
  });
  it("doesn't collect account credentials or create a viewer for account authentication", async () => {
    const request = vi.fn(async (method: string) =>
      method === "sessions.describe"
        ? placed
        : method === "environments.status"
          ? environment
          : method === "desktop.observe"
            ? { ...observed, auth: "ard-account" }
            : {},
    );
    await render(engine(request as any));
    await flush();
    expect(viewer.connect).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("desktop.release", { wsPath: "/desktop/one" });
    expect(container.textContent).toContain("requires authentication");
  });
});
