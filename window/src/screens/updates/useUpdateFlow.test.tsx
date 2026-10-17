// @vitest-environment jsdom
// Private #1089: the update button and banner never show a stack, Error: prefix, JSON, status, id or method name.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRIENDLY_ERROR } from "../../connect/friendly-error";
import type { ComponentUpdateStatus } from "../../connect/desktop-component-updates";
import type { WindowEngine } from "../../connect/engine";
import { UpdateBanner, UpdateButton } from "./UpdateButton";
import { useUpdateFlow } from "./useUpdateFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

const URL = "ws://127.0.0.1:18789/";
const RAW = /Error:|HTTP\s*500|\bupdate\.run\b|00000000-0000-4000-8000-000000000000|\n\s*at\s+|^\s*[{[]|ECONNREFUSED/;
const DUMPS = [
  "Error: boom\n    at send (connect/session.ts:12:3)",
  '{"type":"error","error":{"message":"boom"}}',
  "HTTP 500: Internal Server Error",
  "unknown method: update.run",
  "run 00000000-0000-4000-8000-000000000000 failed",
  "ECONNREFUSED",
];
const available = { updateAvailable: { latestVersion: "0.5.0" } };
const desktopStatus: ComponentUpdateStatus = {
  phase: "available", currentVersion: "0.4.4", latestVersion: "0.5.0", pendingVersion: null, checkedAt: 1, error: null,
};

function engine(run: unknown) {
  const request = vi.fn(async (method: string) => (method === "update.run" ? run : available));
  return { gatewayUrl: URL, request, onEvent: vi.fn(() => () => undefined) };
}
function Harness({ e }: { e: ReturnType<typeof engine> }) {
  const flow = useUpdateFlow(e as unknown as Pick<WindowEngine, "request" | "onEvent" | "gatewayUrl">, true, "0.4.4");
  return <><UpdateButton flow={flow} /><div role="menu"><UpdateBanner flow={flow} /></div></>;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const shown = () => [host.querySelector(".r1u-btn")?.getAttribute("title"), host.querySelector(".r1u-ban-text")?.textContent].join("\n");

describe("useUpdateFlow never shows a raw engine error (Private #1089)", () => {
  it.each(DUMPS)("engine update.run dump becomes the helper sentence: %j", async (raw) => {
    const e = engine({ ok: false, message: raw });
    await act(async () => root.render(<Harness e={e} />));
    await flush();
    await act(async () => (host.querySelector(".r1u-ban-act") as HTMLButtonElement).click());
    await flush();
    expect(shown()).not.toMatch(RAW);
    expect(shown()).toContain(FRIENDLY_ERROR);
  });

  it("keeps already-plain copy from update.run", async () => {
    const e = engine({ ok: false, message: "Tasks are still running." });
    await act(async () => root.render(<Harness e={e} />));
    await flush();
    await act(async () => (host.querySelector(".r1u-ban-act") as HTMLButtonElement).click());
    await flush();
    expect(shown()).toContain("Tasks are still running.");
    expect(shown()).not.toMatch(RAW);
  });

  it.each(DUMPS)("desktop stage dump becomes the helper sentence: %j", async (raw) => {
    (window as { branchDesktop?: unknown }).branchDesktop = {
      gatewayUrl: URL,
      componentUpdates: {
        status: async () => desktopStatus, check: async () => desktopStatus,
        stage: async () => { throw new Error(raw); }, install: vi.fn(),
      },
    };
    await act(async () => root.render(<Harness e={engine({ ok: true })} />));
    await flush();
    await act(async () => host.querySelector<HTMLButtonElement>(".r1u-btn")?.click());
    await flush();
    expect(shown()).not.toMatch(RAW);
    expect(shown()).toContain(FRIENDLY_ERROR);
  });

  it("keeps already-plain copy from desktop stage", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {
      gatewayUrl: URL,
      componentUpdates: {
        status: async () => desktopStatus, check: async () => desktopStatus,
        stage: async () => { throw new Error("Couldn't download the update."); }, install: vi.fn(),
      },
    };
    await act(async () => root.render(<Harness e={engine({ ok: true })} />));
    await flush();
    await act(async () => host.querySelector<HTMLButtonElement>(".r1u-btn")?.click());
    await flush();
    expect(shown()).toContain("Couldn't download the update.");
    expect(shown()).not.toMatch(RAW);
  });
});
