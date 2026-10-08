/* @vitest-environment jsdom */
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDialogPolyfill } from "../../test-helpers/modal-dialog.ts";
import { renderDevicePairSetup } from "./view-pairing.runtime.ts";

let restoreDialogPolyfill: () => void;

function hushGetAnimations(root: ParentNode) {
  const nodes = [root, ...root.querySelectorAll("*")];
  for (const node of nodes) {
    if (node instanceof Element) {
      Object.defineProperty(node, "getAnimations", {
        configurable: true,
        value: () => [],
      });
      if (node.shadowRoot) {
        hushGetAnimations(node.shadowRoot);
      }
    }
  }
}

describe("device pairing dialog", () => {
  beforeEach(() => {
    restoreDialogPolyfill = installDialogPolyfill();
  });

  afterEach(async () => {
    for (const modal of document.querySelectorAll("branch-modal-dialog")) {
      Object.assign(modal, { open: false });
      const update = (modal as { updateComplete?: Promise<unknown> }).updateComplete;
      if (update) {
        await update;
      }
    }
    hushGetAnimations(document);
    document.body.replaceChildren();
    restoreDialogPolyfill();
  });

  it.each([
    {
      access: "full" as const,
      href: "https://docs.openclaw.ai/channels/pairing#pair-from-the-control-ui-recommended",
    },
    {
      access: "node" as const,
      href: "https://docs.openclaw.ai/gateway/pairing#one-paste-node-pairing",
    },
  ])("links $access setup help to the matching workflow", async ({ access, href }) => {
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
    for (const modal of container.querySelectorAll("branch-modal-dialog")) {
      await (modal as { updateComplete: Promise<unknown> }).updateComplete;
    }
    hushGetAnimations(container);

    expect(container.textContent).toContain(
      "Device capabilities plus complete Gateway controls, including settings and upgrades.",
    );
    expect(container.textContent).toContain("Connect a computer as a command and capability host.");
    expect(container.querySelector<HTMLAnchorElement>(".device-pair-setup__footer a")?.href).toBe(
      href,
    );
  });

  it("renders the node one-paste command and quiet expiry countdown", async () => {
    const container = document.createElement("div");
    document.body.append(container);

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
    for (const modal of container.querySelectorAll("branch-modal-dialog")) {
      await (modal as { updateComplete: Promise<unknown> }).updateComplete;
    }
    hushGetAnimations(container);

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
