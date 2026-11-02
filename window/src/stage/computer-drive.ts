// Pure: what you do on the computer's picture, as the computer route's actions (computer.invoke, command
// "computer.act"; the action names and fields of plugins/computer-use-contract.ts). Pointer actions carry the frame
// they were aimed at (displayFrameId and its width as refWidth), which the provider checks before it moves anything.
import type { RemoteAction } from "./DriveSurface";
import { cuaKeys } from "./drive-keys";

export type ComputerFrame = { id: string; width: number; height: number };
export type ComputerActParams = Record<string, unknown> & { action: string };

/** Page pixels per scroll step: a wheel notch or a short two-finger flick is about one step. */
export const SCROLL_STEP_PX = 50;
const MAX_SCROLL = 50;

const steps = (px: number) => Math.min(MAX_SCROLL, Math.max(1, Math.round(Math.abs(px) / SCROLL_STEP_PX)));

export function computerActions(action: RemoteAction, frame: ComputerFrame): ComputerActParams[] {
  const aim = { displayFrameId: frame.id, refWidth: frame.width };
  switch (action.kind) {
    case "click":
      return [{ action: action.button === "right" ? "right_click" : "left_click", x: action.x, y: action.y, ...aim }];
    case "move":
      return [{ action: "mouse_move", x: action.x, y: action.y, ...aim }];
    case "drag":
      return [{ action: "left_click_drag", fromX: action.fromX, fromY: action.fromY, x: action.x, y: action.y, ...aim }];
    case "scroll": {
      const out: ComputerActParams[] = [];
      if (action.dy) out.push({ action: "scroll", x: action.x, y: action.y, scrollDirection: action.dy > 0 ? "down" : "up", scrollAmount: steps(action.dy), ...aim });
      if (action.dx) out.push({ action: "scroll", x: action.x, y: action.y, scrollDirection: action.dx > 0 ? "right" : "left", scrollAmount: steps(action.dx), ...aim });
      return out;
    }
    case "type":
      return action.text ? [{ action: "type", text: action.text }] : [];
    case "key": {
      const keys = cuaKeys(action.key);
      if (keys) return [{ action: "key", keys }];
      // A digit or punctuation key the provider can't press by name goes as the character it types.
      return action.key.length === 1 ? [{ action: "type", text: action.key }] : [];
    }
  }
}
