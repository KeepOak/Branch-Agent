import { describe, expect, it } from "vitest";
import {
  NOT_COMPUTER_CAPABLE_HINT,
  SCREEN_CONTROL_SWITCH_PATH,
} from "./computer-tool-bindings.js";

describe("computer enablement hint", () => {
  it("names the Settings screen-and-mouse switch, not Computer Control pairing", () => {
    expect(SCREEN_CONTROL_SWITCH_PATH).toBe(
      "Settings › Computer & browser › See the screen and use the mouse",
    );
    expect(NOT_COMPUTER_CAPABLE_HINT).toContain(SCREEN_CONTROL_SWITCH_PATH);
    expect(NOT_COMPUTER_CAPABLE_HINT).toMatch(/Full access does not include this/);
    expect(NOT_COMPUTER_CAPABLE_HINT).not.toMatch(/Computer Control|pairing update/i);
  });
});
