/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationContext } from "../../app/context.ts";
import { i18n } from "../../i18n/index.ts";
import { createApplicationContextProvider } from "../../test-helpers/application-context.ts";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import "./model-setup-page.ts";
import { MODEL_SETUP_LOADING_STALL_MS } from "./state.ts";
import { createContext, detection, type TestModelSetupPage } from "./test-helpers/page.test-support.ts";

type Roster = ApplicationContext["agents"]["state"]["agentsList"];

function withSettingsRoster(context: ApplicationContext, agentsList: Roster) {
  Object.assign(context, {
    agents: { state: { agentsList }, subscribe: () => () => undefined },
    settingsAgentSelection: {
      state: { selectedId: null, scopeId: null },
      subscribe: () => () => undefined,
    },
  });
}

function mount(context: ApplicationContext): TestModelSetupPage {
  const provider = createApplicationContextProvider(context);
  const page = document.createElement("branch-model-setup-page") as TestModelSetupPage;
  page.routeData = { firstRun: false };
  provider.append(page);
  document.body.append(provider);
  return page;
}

describe("Model Setup never stays on 'Checking this Gateway…' (#1929)", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("probes the Gateway default when the roster holds only the system agent", async () => {
    const { context, request, runtimeConfig } = createContext();
    withSettingsRoster(context, {
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: "main", kind: "system" }],
    } as Roster);
    request.mockResolvedValue(detection);
    const page = mount(context);

    await waitForFast(() => expect(page.querySelector(".model-setup__loading")).toBeNull());
    expect(request).toHaveBeenCalledWith(
      "branch.setup.detect",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(page.querySelector('[role="alert"]')).toBeNull();
    runtimeConfig.dispose();
  });

  it("turns a loading page with no probe in flight into a retryable error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { context, request, runtimeConfig } = createContext();
    // Roster never arrives: setup cannot start and nothing is requested.
    withSettingsRoster(context, null);
    const page = mount(context);
    await page.updateComplete;
    expect(page.querySelector(".model-setup__loading")).not.toBeNull();
    expect(request).not.toHaveBeenCalledWith(
      "branch.setup.detect",
      expect.anything(),
      expect.anything(),
    );

    vi.advanceTimersByTime(MODEL_SETUP_LOADING_STALL_MS);
    await page.updateComplete;

    expect(page.querySelector(".model-setup__loading")).toBeNull();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      "Model setup request failed.",
    );
    expect(
      [...page.querySelectorAll<HTMLButtonElement>(".model-setup .btn")].some(
        (button) => button.textContent?.trim() === "Retry",
      ),
    ).toBe(true);
    runtimeConfig.dispose();
  });

  it("does not raise the stall error while a detection request is still running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { context, request, runtimeConfig } = createContext();
    request.mockReturnValue(new Promise(() => undefined));
    const page = mount(context);
    await page.updateComplete;
    vi.advanceTimersByTime(MODEL_SETUP_LOADING_STALL_MS * 2);
    await page.updateComplete;
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(request).toHaveBeenCalledWith("branch.setup.detect", expect.anything(), expect.anything());
    runtimeConfig.dispose();
  });
});
