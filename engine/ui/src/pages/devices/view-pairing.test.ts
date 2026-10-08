/* @vitest-environment jsdom */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDevicePairSetup } from "./view-pairing.runtime.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("device pairing dialog", () => {
  it.each([
    {
      access: "full" as const,
      href: "https://docs.openclaw.ai/channels/pairing#pair-from-the-control-ui-recommended",
    },
    {
      access: "node" as const,
      href: "https://docs.openclaw.ai/gateway/pairing#one-paste-node-pairing",
    },
  ])("links $access setup help to the matching workflow", ({ access, href }) => {
    // Light DOM is enough: awaiting branch-modal-dialog updateComplete hung
    // Windows jsdom for 120s while Web Awesome opened the dialog.
    const container = document.createElement("div");

    render(
      renderDevicePairSetup({
        open: true,
        lifecycle: { phase: "selection", access },
        nowMs: 0,
        pendingCount: 0,
        onRefresh: vi.fn(),
        onAccessChange: vi.fn(),
        onClose: vi.fn(),
        onManageDevices: vi.fn(),
        onGetApps: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain(
      "Device capabilities plus complete Gateway controls, including settings and upgrades.",
    );
    expect(container.textContent).toContain("Connect a computer as a command and capability host.");
    expect(container.querySelector<HTMLAnchorElement>(".device-pair-setup__footer a")?.href).toBe(
      href,
    );
  });

  it("renders the node one-paste command and quiet expiry countdown", () => {
    const container = document.createElement("div");

    render(
      renderDevicePairSetup({
        open: true,
        lifecycle: {
          phase: "waiting",
          access: "node",
          setup: {
            setupId: "setup-node",
            setupCode: "AbC_123",
            gatewayUrl: "wss://gateway.example",
            auth: "token",
            urlSource: "test",
            access: "node",
            expiresAtMs: 70_000,
          },
        },
        nowMs: 10_000,
        pendingCount: 0,
        onRefresh: vi.fn(),
        onAccessChange: vi.fn(),
        onClose: vi.fn(),
        onManageDevices: vi.fn(),
        onGetApps: vi.fn(),
      }),
      container,
    );

    expect(container.querySelectorAll('input[name="device-pair-access"]')).toHaveLength(3);
    const commandText = container.querySelector(".device-pair-setup__command code")?.textContent;
    expect(commandText).toBe("branch node run --pair -");
    expect(commandText).not.toContain("AbC_123");
    expect(container.textContent).toContain("oc-pair://AbC_123");
    expect(container.textContent).toContain("When prompted, paste this setup code:");
    expect(container.querySelector('[role="timer"]')?.textContent?.trim()).toBe(
      "This setup link expires in 1:00.",
    );
  });
});
