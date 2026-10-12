import { Value } from "typebox/value";
import { beforeEach, describe, expect, it } from "vitest";
import {
  callGatewayToolMock,
  createVisionComputerTool,
  EFFECTIVE_REF_WIDTH,
  listNodesMock,
  macComputerNode,
  readFrameId,
  readLastComputerActParams,
  resetComputerToolMocks,
  v2Descriptor,
} from "./computer-tool.test-helpers.js";

describe("UI-TARS production computer caller", () => {
  beforeEach(resetComputerToolMocks);
  it("advertises raw predictions and dispatches mapped screenshot pixels", async () => {
    const tool = createVisionComputerTool();
    const frameId = readFrameId(await tool.execute("shot", { action: "screenshot" }));
    const input = {
      action: "left_click",
      frameId,
      uiTarsScreen: [EFFECTIVE_REF_WIDTH, 750],
      uiTarsPrediction: "click(start_box='(500,500)')",
    };
    expect(Value.Check(tool.parameters, input)).toBe(true);
    await tool.execute("click", input);
    expect(readLastComputerActParams("left_click")).toMatchObject({
      action: "left_click",
      x: EFFECTIVE_REF_WIDTH / 2,
      y: 375,
      displayFrameId: "display-0-frame",
      refWidth: EFFECTIVE_REF_WIDTH,
    });
  });
  it("rejects a prediction with stale frame authority before input dispatch", async () => {
    const tool = createVisionComputerTool();
    await tool.execute("shot", { action: "screenshot" });
    callGatewayToolMock.mockClear();
    await expect(
      tool.execute("stale", {
        action: "left_click",
        frameId: "stale-frame",
        uiTarsScreen: [1200, 750],
        uiTarsPrediction: "click(start_box='(100,100)')",
      }),
    ).rejects.toThrow(/frame|screenshot/i);
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });
  it("does not bypass the provider capability set for a predicted action", async () => {
    listNodesMock.mockResolvedValue([
      macComputerNode({ computerUse: v2Descriptor(["screenshot", "type"]) }),
    ]);
    const tool = createVisionComputerTool();
    const frameId = readFrameId(await tool.execute("shot", { action: "screenshot" }));
    callGatewayToolMock.mockClear();
    await expect(
      tool.execute("unsupported", {
        action: "left_click",
        frameId,
        uiTarsScreen: [1200, 750],
        uiTarsPrediction: "click(start_box='(100,100)')",
      }),
    ).rejects.toThrow();
    expect(callGatewayToolMock).not.toHaveBeenCalled();
  });
});
