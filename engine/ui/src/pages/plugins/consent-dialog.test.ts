/* @vitest-environment jsdom */

import { nothing, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapabilityConsentErrorDetails } from "../../../../packages/gateway-protocol/src/capability-consent-error-details.js";
import { i18n } from "../../i18n/index.ts";
import { renderArtTile, renderPluginConsentDialog } from "./consent-dialog.ts";
import { createInspectResult } from "./plugins-page.test-support.ts";

type ConsentProps = Parameters<typeof renderPluginConsentDialog>[0];

function mount(overrides: Partial<ConsentProps> = {}): HTMLDivElement {
  const props: ConsentProps = {
    consent: {
      intent: { kind: "enable", pluginId: "canopy", rowKey: "plugin:canopy" },
      pluginId: "canopy",
      fallback: { name: "Canopy" },
    },
    inspection: createInspectResult(),
    loading: false,
    error: null,
    canMutate: true,
    mutationBlockedReason: null,
    busy: false,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    onRetry: () => undefined,
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  render(renderPluginConsentDialog(props), container);
  return container;
}

function normalizedText(element: Element | null): string {
  return element?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}

describe("renderPluginConsentDialog", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    for (const container of document.body.querySelectorAll("div")) {
      render(nothing, container);
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each([
    {
      source: {
        kind: "clawhub",
        packageName: "@branch/calendar-plus",
        integrity: "sha256-0123456789abcdefghijklmnop",
        integrityKind: "ssri",
      },
      provenance: "Seedbank · @branch/calendar-plus",
      integrityLabel: "Integrity: sha256-0123456789abc…",
    },
    {
      source: {
        kind: "git",
        spec: "https://***:***@example.com/calendar.git?token=***#main",
        packageName: "@branch/calendar-plus",
        integrity: "0123456789abcdef0123456789abcdef01234567",
        integrityKind: "git-commit",
      },
      provenance: "Git · https://***:***@example.com/calendar.git?token=***#main",
      integrityLabel: "Commit: 0123456789abcdef0123…",
    },
  ] as const)(
    "presents capabilities, grants, safe $source.kind provenance, and trust before enablement",
    ({ source, provenance, integrityLabel }) => {
      const inspection = createInspectResult({
        plugin: {
          id: "calendar-runtime",
          name: "Calendar Plus",
          version: "2.0.0",
          origin: "global",
          installed: true,
          enabled: false,
        },
        source,
        declared: {
          channels: ["calendar-channel"],
          providers: ["calendar-provider"],
          tools: ["calendar_create"],
          contracts: ["gatewayMethodDispatch: calendar.dispatch"],
          hooks: ["before_prompt_build"],
          mcpServers: ["calendar-mcp"],
          cliCommands: ["calendar"],
          cliBackends: ["calendar-cli"],
          skills: ["schedule"],
          dangerousConfigFlags: ["calendar.allowShell"],
        },
        grants: {
          hooks: {
            allowPromptInjection: { effective: false, configured: false },
            allowConversationAccess: { effective: false },
          },
          llm: { allowedModels: ["model-a", "model-b"] },
          subagent: { allowModelOverride: true },
        },
        trust: {
          disposition: "review-required",
          reasons: ["Requests an elevated permission"],
          checkedAt: "2026-08-25",
        },
      });
      const onConfirm = vi.fn();
      const container = mount({
        consent: {
          intent: {
            kind: "enable",
            pluginId: "calendar-runtime",
            rowKey: "plugin:calendar-runtime",
          },
          pluginId: "calendar-runtime",
          fallback: { name: "Calendar Plus", version: "2.0.0" },
        },
        inspection,
        onConfirm,
      });

      const dialog = container.querySelector('[data-plugin-consent="enable"]');
      const text = normalizedText(dialog);
      for (const value of [
        "Calendar Plus",
        "v2.0.0",
        "@branch/calendar-plus",
        provenance,
        integrityLabel,
        "Review required",
        "Requests an elevated permission",
        "Scanned 2026-08-25",
        "calendar-channel",
        "calendar-provider",
        "calendar_create",
        "Contracts gatewayMethodDispatch: calendar.dispatch",
        "before_prompt_build",
        "calendar-mcp",
        "calendar-cli",
        "schedule",
        "Dangerous config flags calendar.allowShell",
        "Prompt injection Blocked (set in config)",
        "Conversation access Off (default)",
        "Off by default for external plugins.",
        "Allowed models: model-a, model-b",
        "Subagent model overrides Model override: Allowed",
        "Enable Calendar Plus",
      ]) {
        expect(text).toContain(value);
      }
      expect(dialog?.querySelector("[title]")?.getAttribute("title")).toBe(source.integrity);
      dialog?.querySelector<HTMLButtonElement>(".btn.primary")?.click();
      expect(onConfirm).toHaveBeenCalledOnce();
    },
  );

  it("explains an empty manifest and preserves external-plugin grants", () => {
    const container = mount();
    const text = normalizedText(container.querySelector('[data-plugin-consent="enable"]'));

    expect(text).toContain("No channels, providers, or tools declared in the manifest.");
    expect(text).toContain(
      "Code plugins may register hooks at runtime; their hook names are not declared in the manifest.",
    );
    expect(text).toContain("Your grants");
    expect(text).toContain("Enable Canopy");
    expect(text).not.toContain("What changed");
  });

  it("highlights newly declared capability groups since the previous acceptance", () => {
    const reviewToken = "a".repeat(64);
    const inspection = createInspectResult({
      reviewToken,
      declared: {
        ...createInspectResult().declared,
        tools: ["canopy_review"],
        contracts: ["gatewayMethodDispatch: canopy.dispatch"],
        providers: ["canopy-provider"],
        dangerousConfigFlags: ["canopy.allowShell"],
      },
    });
    const container = mount({
      consent: {
        intent: { kind: "enable", pluginId: "canopy", rowKey: "plugin:canopy" },
        pluginId: "canopy",
        fallback: { name: "Canopy" },
        details: buildCapabilityConsentErrorDetails({
          pluginId: "canopy",
          reviewToken,
          widened: {
            tools: ["canopy_review"],
            contracts: ["gatewayMethodDispatch: canopy.dispatch"],
            providers: ["canopy-provider"],
            dangerousConfigFlags: ["canopy.allowShell"],
          },
          acceptedAt: "2026-08-20T14:03:00Z",
        }),
      },
      inspection,
    });

    const dialog = container.querySelector('[data-plugin-consent="enable"]');
    const text = normalizedText(dialog);
    expect(text).toContain("What changed");
    expect(text).toContain("New since your last acceptance");
    expect(text).toContain("2026-08-20T14:03:00Z");
    expect(text).toContain("Tools canopy_review");
    expect(text).toContain("Contracts gatewayMethodDispatch: canopy.dispatch");
    expect(text).toContain("Model providers canopy-provider");
    expect(text).toContain("Dangerous config flags canopy.allowShell");
    expect(text.indexOf("What changed")).toBeLessThan(text.indexOf("Declared capabilities"));
    expect(dialog?.querySelectorAll(".plugins-consent__row--warning")).toHaveLength(5);
  });

  it("prevents approval until the package capabilities have been inspected", () => {
    const container = mount({
      consent: {
        intent: {
          kind: "enable",
          pluginId: "community-calendar",
          rowKey: "plugin:community-calendar",
        },
        pluginId: "community-calendar",
        fallback: {
          name: "Community Calendar",
          version: "1.2.0",
          official: false,
        },
      },
      inspection: null,
    });

    const dialog = container.querySelector('[data-plugin-consent="enable"]');
    expect(normalizedText(dialog)).toContain("Community Calendar");
    expect(normalizedText(dialog)).toContain(
      "Capability details must be available before you can approve this plugin.",
    );
    expect(dialog?.querySelector<HTMLButtonElement>(".btn.primary")?.disabled).toBe(true);
  });

  it("keeps blocked consent confirmation reachable without dispatching it", async () => {
    const onConfirm = vi.fn();
    const container = mount({
      canMutate: false,
      mutationBlockedReason: "Admin access required.",
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(".btn.primary");

    expect(confirm?.disabled).toBe(false);
    expect(confirm?.getAttribute("aria-disabled")).toBe("true");
    const tooltip = confirm?.closest("branch-tooltip") as
      | (HTMLElement & { content?: string; updateComplete: Promise<unknown> })
      | null;
    await tooltip?.updateComplete;
    expect(tooltip?.content).toBe("Admin access required.");
    expect(confirm?.getAttribute("aria-describedby")).toBeTruthy();
    confirm?.focus();
    expect(document.activeElement).toBe(confirm);
    confirm?.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

it("tries the author image after a broken package image, then retains initials until the source changes", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const tile = (url: string) =>
    renderArtTile("lossless-grove", "Lossless Context Management", {
      iconUrl: url,
      authorIconUrl: "blob:author",
    });
  render(tile("blob:package"), container);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:package");
  container.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:author");
  container.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent?.trim()).toBe("LC");
  render(tile("blob:package"), container);
  expect(container.querySelector("img")).toBeNull();
  render(tile("blob:updated"), container);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:updated");
  render(nothing, container);
  container.remove();
});
