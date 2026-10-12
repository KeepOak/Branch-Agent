import { normalizeActionCoords } from "./computer-ui-tars-coordinates.js";
import { actionParser } from "./computer-ui-tars-parser.js";
import { UITarsModelVersion } from "./computer-ui-tars-types.js";

const ACTION_NAMES: Record<string, string> = {
  click: "left_click",
  left_click: "left_click",
  left_single: "left_click",
  left_double: "double_click",
  double_click: "double_click",
  right_click: "right_click",
  right_single: "right_click",
  middle_click: "middle_click",
  middle_single: "middle_click",
  drag: "left_click_drag",
  select: "left_click_drag",
  left_click_drag: "left_click_drag",
  move: "mouse_move",
  hover: "mouse_move",
  mouse_move: "mouse_move",
  hotkey: "key",
  key: "key",
  type: "type",
  scroll: "scroll",
  wait: "wait",
  screenshot: "screenshot",
};

function positivePair(value: unknown, name: string): [number, number] {
  const pair = typeof value === "number" ? [value, value] : value;
  if (
    !Array.isArray(pair) ||
    pair.length !== 2 ||
    pair.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0)
  ) {
    throw new Error(`${name} must contain two positive finite numbers`);
  }
  return [pair[0] as number, pair[1] as number];
}

/** Translate a model prediction into the existing single-action tool contract. */
export function prepareUiTarsComputerInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (input.uiTarsPrediction === undefined) return input;
  if (typeof input.uiTarsPrediction !== "string")
    throw new Error("uiTarsPrediction must be a string");
  const factor = positivePair(input.uiTarsFactor ?? 1000, "uiTarsFactor");
  const screen =
    input.uiTarsScreen === undefined ? undefined : positivePair(input.uiTarsScreen, "uiTarsScreen");
  const mode = input.uiTarsMode ?? "bc";
  if (mode !== "bc" && mode !== "o1") throw new Error("uiTarsMode must be bc or o1");
  const modelVer = input.uiTarsModelVersion ?? UITarsModelVersion.V1_0;
  if (!Object.values(UITarsModelVersion).includes(modelVer as UITarsModelVersion))
    throw new Error("Unknown uiTarsModelVersion");
  const { parsed } = actionParser({
    prediction: input.uiTarsPrediction,
    factor,
    mode,
    modelVer: modelVer as UITarsModelVersion,
    screenContext: screen ? { width: screen[0], height: screen[1] } : undefined,
  });
  if (parsed.length !== 1)
    throw new Error("Submit each parsed UI-TARS action as a separate computer call");
  const prediction = parsed[0];
  if (!prediction) throw new Error("No UI-TARS action found");
  const action = ACTION_NAMES[prediction.action_type];
  if (!action) throw new Error(`Unsupported computer action: ${prediction.action_type}`);
  if (input.action !== action) throw new Error(`UI-TARS action requires action=${action}`);
  const result = { ...input };
  const fields = prediction.action_inputs;
  const coords: Record<string, unknown> = {};
  for (const [box, key] of [
    ["start_box", "start"],
    ["end_box", "end"],
  ] as const) {
    if (fields[box] === undefined) continue;
    const raw = fields[key === "start" ? "start_coords" : "end_coords"];
    if (!Array.isArray(raw) || raw.length !== 2 || raw.some((n) => !Number.isFinite(n)))
      throw new Error("UI-TARS coordinates require uiTarsScreen from the latest screenshot");
    coords[key] = { raw: { x: raw[0], y: raw[1] } };
  }
  const normalized = normalizeActionCoords({ type: action, inputs: coords }, (coordinate) => ({
    normalized: { x: Math.round(coordinate.raw.x), y: Math.round(coordinate.raw.y) },
  }));
  const coordinatePair = (key: "start" | "end") => {
    const point = normalized.inputs[key] as { x: number; y: number } | undefined;
    return point ? [point.x, point.y] : undefined;
  };
  const start = coordinatePair("start"),
    end = coordinatePair("end");
  const inferred: Record<string, unknown> = {};
  if (action === "left_click_drag") {
    if (start) inferred.startCoordinate = start;
    if (end) inferred.coordinate = end;
  } else if (start && action !== "type" && action !== "key") inferred.coordinate = start;
  if (action === "type") inferred.text = fields.content ?? fields.text;
  if (action === "key") inferred.text = fields.key;
  if (action === "scroll") {
    inferred.scrollDirection = fields.direction;
    if (fields.amount !== undefined) inferred.scrollAmount = Number(fields.amount);
  }
  if (action === "wait" && (fields.time !== undefined || fields.duration !== undefined))
    inferred.duration = Number(String(fields.time ?? fields.duration).replace(/s$/, ""));
  for (const [key, value] of Object.entries(inferred)) {
    if (value === undefined) continue;
    if (input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(value))
      throw new Error(`UI-TARS prediction conflicts with ${key}`);
    result[key] = value;
  }
  return result;
}
