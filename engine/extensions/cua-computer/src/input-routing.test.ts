import { describe, expect, it } from "vitest";
import { createCuaComputerProvider } from "./commands.js";
import { driver, execution, macOsEndpoint } from "./commands.test-helpers.js";
import {
  CUA_DRIVER_CONTRACT_FIXTURES,
  cuaToolResult,
} from "./cua-driver-contract.test-fixtures.js";
import {
  FOCUSED_INPUT_NOTICE,
  detectComputerInputBackends,
  hasFocusFreeInputBackend,
  mustUseFocusedInput,
  resolveWindowInputDelivery,
} from "./input-routing.js";

function windowDriver() {
  const native = driver();
  native.callTool.mockImplementation(async (name) => {
    if (name === "list_windows") {
      return cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows);
    }
    if (name === "get_window_state") {
      return cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.windowState, { image: true });
    }
    return cuaToolResult({});
  });
  return native;
}

async function observedClick(
  inputBackends: readonly string[],
  deliveryMode?: "background" | "foreground",
) {
  const native = windowDriver();
  const computer = await execution(native.session, "linux", { inputBackends });
  const listed = JSON.parse(await computer.act('{"action":"list_windows"}')) as {
    details: { windows: Array<{ windowRef: string }> };
  };
  const windowRef = listed.details.windows[0]!.windowRef;
  const observed = JSON.parse(
    await computer.act(JSON.stringify({ action: "get_window_state", windowRef })),
  ) as { observation: { observationId: string } };
  native.callTool.mockClear();
  const first = JSON.parse(
    await computer.act(
      JSON.stringify({
        action: "left_click",
        windowRef,
        observationId: observed.observation.observationId,
        x: 20,
        y: 30,
        ...(deliveryMode ? { deliveryMode } : {}),
      }),
    ),
  ) as { details?: { notice?: string; deliveryMode?: string } };
  const second = JSON.parse(
    await computer.act(
      JSON.stringify({
        action: "left_click",
        windowRef,
        observationId: observed.observation.observationId,
        x: 24,
        y: 32,
        ...(deliveryMode ? { deliveryMode } : {}),
      }),
    ),
  ) as { details?: { notice?: string } };
  return { native, first, second };
}

describe("computer input routing", () => {
  it("treats XTest as focus-bound and AT-SPI as focus-free", () => {
    expect(hasFocusFreeInputBackend(["xtest"])).toBe(false);
    expect(mustUseFocusedInput(["xtest"])).toBe(true);
    expect(hasFocusFreeInputBackend(["xtest", "atspi"])).toBe(true);
    expect(mustUseFocusedInput(["xtest", "atspi"])).toBe(false);
    expect(mustUseFocusedInput([])).toBe(false);
  });

  it("probes Linux X11 as XTest-only and keeps macOS/Windows focus-free", () => {
    expect(
      detectComputerInputBackends({
        platform: "linux",
        env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
      }),
    ).toEqual(["xtest"]);
    expect(
      detectComputerInputBackends({
        platform: "linux",
        env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
      }),
    ).toEqual([]);
    expect(detectComputerInputBackends({ platform: "darwin", env: {} })).toEqual(["accessibility"]);
    expect(detectComputerInputBackends({ platform: "win32", env: {} })).toEqual(["ui_automation"]);
  });

  it("routes XTest-only hosts to focused input even when background was requested", () => {
    expect(resolveWindowInputDelivery({ backends: ["xtest"] })).toEqual({
      deliveryMode: "foreground",
      focusedBecauseNoFocusFree: true,
    });
    expect(
      resolveWindowInputDelivery({ backends: ["xtest"], requested: "background" }),
    ).toEqual({
      deliveryMode: "foreground",
      focusedBecauseNoFocusFree: true,
    });
  });

  it("keeps background-first routing when a focus-free backend is present", () => {
    expect(
      resolveWindowInputDelivery({ backends: ["atspi"], requested: "background" }),
    ).toEqual({
      deliveryMode: "background",
      focusedBecauseNoFocusFree: false,
    });
    expect(resolveWindowInputDelivery({ backends: ["atspi"] })).toEqual({
      deliveryMode: undefined,
      focusedBecauseNoFocusFree: false,
    });
  });

  it("uses focused input on the first action when only XTest is available", async () => {
    const { native, first, second } = await observedClick(["xtest"], "background");
    expect(native.callTool.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ delivery_mode: "foreground" }),
      expect.objectContaining({ delivery_mode: "foreground" }),
    ]);
    expect(native.callTool.mock.calls.some((call) => call[1]?.delivery_mode === "background")).toBe(
      false,
    );
    expect(first.details?.notice).toBe(FOCUSED_INPUT_NOTICE);
    expect(second.details?.notice).toBeUndefined();
  });

  it("still tries background delivery first when a focus-free backend is available", async () => {
    const { native, first } = await observedClick(["xtest", "atspi"], "background");
    expect(native.callTool.mock.calls[0]?.[1]).toMatchObject({ delivery_mode: "background" });
    expect(first.details?.notice).toBeUndefined();
  });

  it("advertises only foreground delivery when the host has no focus-free backend", () => {
    const { session } = driver();
    expect(
      createCuaComputerProvider({
        platform: "linux",
        env: macOsEndpoint(),
        driver: session,
        inputBackends: ["xtest"],
      }).capabilities().deliveryModes,
    ).toEqual(["foreground"]);
    expect(
      createCuaComputerProvider({
        platform: "linux",
        env: macOsEndpoint(),
        driver: session,
        inputBackends: ["xtest", "atspi"],
      }).capabilities().deliveryModes,
    ).toEqual(["background", "foreground"]);
  });
});
