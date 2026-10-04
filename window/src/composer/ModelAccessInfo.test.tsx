// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelAccessInfo } from "./ModelAccessInfo";
import { ModelMenu } from "./ModelMenu";
import { readModel } from "./model";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render(fields: Record<string, unknown>) {
  const model = readModel({ id: "test-model", provider: "test-provider", ...fields }) ?? undefined;
  await act(async () => root.render(<ModelAccessInfo model={model} />));
}

describe("read-only model runtime information", () => {
  it("names only the runtime actually advertised for the selected model", async () => {
    await render({ available: true, agentRuntime: { id: "codex", source: "session" } });
    expect(host.textContent).toContain("Codex");
    expect(host.querySelectorAll("button, input, select, a")).toHaveLength(0);
    expect(host.textContent).not.toContain("ChatGPT plan");
    expect(host.textContent).not.toContain("signed in");
  });

  it("shows unknown readiness without inventing a runtime or account", async () => {
    await render({});
    expect(host.textContent).toContain("Availability not reported");
    expect(host.textContent).not.toContain("Codex");
    expect(host.textContent).not.toContain("100%");
  });

  it("shows the source sign-in reason without treating provider identity as a native login", async () => {
    await render({ available: false, unavailableReason: "missing-auth" });
    expect(host.textContent).toContain("Sign-in needed");
    expect(host.textContent).not.toContain("Codex");
  });

  it("does not present an available alternative runtime as the selected runtime", async () => {
    await render({ available: false, unavailableReason: "auth-failed", agentRuntime: { id: "branch", source: "session" },
      runtimeChoices: [{ agentRuntime: { id: "codex", source: "model" }, available: true }] });
    expect(host.textContent).toContain("Branch");
    expect(host.textContent).toContain("Sign-in needs attention");
    expect(host.textContent).not.toContain("Codex");
  });

  it("retains a cooldown retry time and handles an invalid calendar date", async () => {
    await render({ available: false, unavailableReason: "cooldown", unavailableUntil: 1893456000000 });
    expect(host.textContent).toContain("Resting after a limit");
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2030-01-01T00:00:00.000Z");
    await render({ available: false, unavailableReason: "cooldown", unavailableUntil: Number.MAX_SAFE_INTEGER });
    expect(host.querySelector("time")).toBeNull();
  });

  it("does not add a redundant status when readiness is known and the runtime is unpublished", async () => {
    await render({ available: true });
    expect(host.textContent).toBe("");
  });

  it("renders native metadata inside the actual model menu without selecting or probing", async () => {
    const model = readModel({ id: "test-model", provider: "test-provider", name: "Test model", available: true,
      agentRuntime: { id: "codex", source: "session" }, thinkingLevels: [{ id: "high", label: "High" }] });
    if (!model) throw new Error("Model fixture must be valid");
    const anchor = { current: document.body.appendChild(document.createElement("button")) };
    const patch = vi.fn(async () => undefined);
    await act(async () => root.render(<ModelMenu anchor={anchor} onClose={() => undefined} models={[model]}
      loading={false} error={null} current={model} currentRef={model.ref} row={{}} thinking="high"
      trunkName="Test trunk" isAdmin patch={patch} onKeepForTrunk={async () => undefined} onRetry={() => undefined} />));
    expect(host.querySelector(".c-model")?.textContent).toContain("Runs through Codex");
    expect(host.querySelector('[data-testid="model-option"]')?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector(".c-model-access-info")?.querySelectorAll("button, input, select, a")).toHaveLength(0);
    expect(patch).not.toHaveBeenCalled();
    anchor.current.remove();
  });

  it.each([
    ["cooldown", "resting after a limit"],
    ["auth-failed", "sign-in needs attention"],
    ["missing-auth", "sign-in needed"],
    ["unsupported-runtime", "runtime unavailable"],
    [undefined, "unavailable"],
  ])("shows the known unavailable reason %s in the actual model option", async (unavailableReason, expected) => {
    const model = readModel({ id: "test-model", provider: "test-provider", available: false, unavailableReason });
    if (!model) throw new Error("Model fixture must be valid");
    const anchor = { current: document.body.appendChild(document.createElement("button")) };
    const patch = vi.fn(async () => undefined);
    await act(async () => root.render(<ModelMenu anchor={anchor} onClose={() => undefined} models={[model]}
      loading={false} error={null} current={model} currentRef={model.ref} row={{}} thinking=""
      trunkName="Test trunk" isAdmin patch={patch} onKeepForTrunk={async () => undefined} onRetry={() => undefined} />));
    const option = host.querySelector('[data-testid="model-option"]');
    expect(option?.textContent).toContain(expected);
    expect(option?.textContent).not.toContain("not signed in");
    expect(patch).not.toHaveBeenCalled();
    anchor.current.remove();
  });
});
