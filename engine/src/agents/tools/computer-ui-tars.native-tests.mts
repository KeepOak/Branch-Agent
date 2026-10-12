import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("./computer-ui-tars-") && specifier.endsWith(".js"))
      return nextResolve(specifier.slice(0, -3) + ".ts", context);
    return nextResolve(specifier, context);
  },
});
const { prepareUiTarsComputerInput: prepare } = await import("./computer-ui-tars-input.ts");
const { actionParser } = await import("./computer-ui-tars-parser.ts");
const { normalizeActionCoords } = await import("./computer-ui-tars-coordinates.ts");

test("maps a model box to screenshot pixels while retaining dispatch authority", () => {
  const input = {
    action: "left_click",
    frameId: "latest-frame",
    uiTarsScreen: [1920, 1080],
    uiTarsPrediction: "Thought: Select button\nAction: click(start_box='(100,200,300,400)')",
  };
  assert.deepEqual(prepare(input), { ...input, coordinate: [384, 324] });
  assert.equal(input.coordinate, undefined);
});
test("scales drag origin and destination with independent model factors", () => {
  const input = {
    action: "left_click_drag",
    observationId: "latest",
    uiTarsScreen: [1920, 1080],
    uiTarsFactor: [1920, 1080],
    uiTarsPrediction: "drag(start_box='(10,20)', end_box='(100,200)')",
  };
  assert.deepEqual(prepare(input), { ...input, startCoordinate: [10, 20], coordinate: [100, 200] });
});
test("supports bbox and point token formats from donor", () => {
  assert.deepEqual(
    prepare({
      action: "left_click",
      uiTarsScreen: [1000, 1000],
      uiTarsPrediction: "click(point='<point>510 150</point>')",
    }).coordinate,
    [510, 150],
  );
  assert.deepEqual(
    prepare({
      action: "left_click",
      uiTarsScreen: [1000, 1000],
      uiTarsPrediction: "click(start_box='<bbox>10 20 30 40</bbox>')",
    }).coordinate,
    [20, 30],
  );
});
test("retains equals and commas inside typed content", () => {
  assert.equal(
    prepare({ action: "type", uiTarsPrediction: "type(content='hello, a=b')" }).text,
    "hello, a=b",
  );
});
test("maps key and scroll inputs to existing production request fields", () => {
  assert.equal(prepare({ action: "key", uiTarsPrediction: "hotkey(key='ctrl+c')" }).text, "ctrl+c");
  assert.equal(
    prepare({ action: "scroll", uiTarsPrediction: "scroll(direction='down', amount='6')" })
      .scrollAmount,
    6,
  );
});
test("does not alter existing structured arguments", () => {
  const input = { action: "left_click", coordinate: [2, 3], frameId: "f" };
  assert.equal(prepare(input), input);
});
test("rejects conflicting structured and predicted actions before dispatch", () => {
  assert.throws(
    () => prepare({ action: "type", uiTarsPrediction: "click(start_box='(10,20)')" }),
    /action=left_click/,
  );
  assert.throws(
    () => prepare({ action: "type", text: "other", uiTarsPrediction: "type(content='hello')" }),
    /conflicts with text/,
  );
});
test("requires finite screenshot dimensions and model factors for coordinate actions", () => {
  assert.throws(
    () => prepare({ action: "left_click", uiTarsPrediction: "click(start_box='(10,20)')" }),
    /uiTarsScreen/,
  );
  for (const value of [0, NaN, Infinity, -1])
    assert.throws(
      () =>
        prepare({ action: "type", uiTarsFactor: value, uiTarsPrediction: "type(content='text')" }),
      /positive finite/,
    );
});
test("keeps donor multi-action parsing available and requires separate native tool calls", () => {
  const prediction = "click(start_box='(10,20)')\n\ntype(content='text')";
  assert.equal(actionParser({ prediction, factor: 1000 }).parsed.length, 2);
  assert.throws(
    () => prepare({ action: "left_click", uiTarsPrediction: prediction }),
    /separate computer call/,
  );
});
test("does not invent native finished or call_user actions", () => {
  assert.throws(
    () => prepare({ action: "wait", uiTarsPrediction: "call_user()" }),
    /Unsupported computer action/,
  );
});
test("normalizes point, start and end through donor coordinate normalizer", () => {
  const result = normalizeActionCoords(
    {
      type: "drag",
      inputs: {
        point: { raw: { x: 1, y: 2 } },
        start: { raw: { x: 3, y: 4 } },
        end: { raw: { x: 5, y: 6 } },
      },
    },
    (c) => ({ normalized: { x: c.raw.x * 2, y: c.raw.y * 3 } }),
  );
  assert.deepEqual(result.inputs, {
    point: { x: 2, y: 6 },
    start: { x: 6, y: 12 },
    end: { x: 10, y: 18 },
  });
});
test("preserves V1.5 smart resize factors before adapting to screenshot pixels", () => {
  assert.deepEqual(
    prepare({
      action: "left_click",
      uiTarsModelVersion: "1.5",
      uiTarsScreen: [1000, 1000],
      uiTarsPrediction: "click(start_box='(504,504)')",
    }).coordinate,
    [500, 500],
  );
});
