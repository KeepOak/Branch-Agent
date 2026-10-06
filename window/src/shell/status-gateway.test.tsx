// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { Menu, type MenuItem } from "./Menu";
import { StatusBar, type ConnectionPhase, type GatewayPhase, type StatusItem } from "./StatusBar";
import { RESUME_MISSING, StatusLeftExtras } from "./StatusExtras";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function StatusFixture({ connection, gateway }: { connection: ConnectionPhase; gateway: GatewayPhase }) {
  const [open, setOpen] = useState<StatusItem | null>(null);
  return <StatusBar connection={connection} gateway={gateway} machineName="Fixture"
    roomUsed={null} running={0} version="" usage={null} open={open} onItem={setOpen} />;
}

async function mountStatus(connection: ConnectionPhase, gateway: GatewayPhase) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<StatusFixture connection={connection} gateway={gateway} />));
  return host.querySelector<HTMLButtonElement>("[data-testid=sb-gateway]")!;
}

describe("independent gateway status", () => {
  it.each(["connected", "offline"] as const)("shows a genuine health check while the socket is %s", async (connection) => {
    const gateway = await mountStatus(connection, "checking");
    expect(gateway.textContent).toBe("CheckingGateway");
    expect(gateway.querySelector("i")?.className).toBe("dot wait");
    expect(gateway.dataset.state).toBe("checking");
  });

  it("shows a healthy gateway while a separate socket reconnects", async () => {
    const gateway = await mountStatus("connecting", "on");
    expect(gateway.textContent).toBe("Gateway");
    expect(gateway.querySelector("i")?.className).toBe("dot on");
  });

  it("keeps failed health offline even when the socket is connected", async () => {
    const gateway = await mountStatus("connected", "offline");
    expect(gateway.textContent).toBe("OfflineGateway");
    expect(gateway.querySelector("i")?.className).toBe("dot");
  });

  it("opens the gateway item through the existing status callback", async () => {
    const gateway = await mountStatus("connected", "on");
    expect(gateway.getAttribute("aria-expanded")).toBe("false");
    await act(async () => gateway.click());
    expect(gateway.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("paused Trunks", () => {
  it("greys Resume with its reason because the engine has no resume method", async () => {
    const request = vi.fn(async () => ({}));
    let items: MenuItem[] = [];
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<StatusLeftExtras session={{ request } as unknown as SaplingSession} ready={false}
      paused={[{ id: "a", name: "Rowan" }]} allPaused={false} gfx={false}
      onMenu={(_e, _id, next) => { items = next; }} onSettings={() => {}} />));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=sb-paused]")!.click());
    await act(async () => root?.render(<Menu at={{ x: 0, y: 0 }} items={items} onClose={() => {}} label="Paused Trunks" />));
    const resume = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Resume Rowan"))!;
    expect(resume.disabled).toBe(true);
    expect(resume.title).toBe(RESUME_MISSING);
    expect(resume.textContent).toContain(RESUME_MISSING);
    await act(async () => resume.click());
    expect(request).not.toHaveBeenCalled();
  });
});
