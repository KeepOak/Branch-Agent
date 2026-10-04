// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBar, type ConnectionPhase, type GatewayPhase, type StatusItem } from "./StatusBar";

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
