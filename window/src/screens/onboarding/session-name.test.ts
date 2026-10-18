// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { recalledSessionName, rememberSessionName } from "./session-name";

afterEach(() => rememberSessionName(""));

it("remembers a name for later greetings in this window", () => {
  rememberSessionName("  Ada  ");
  expect(recalledSessionName()).toBe("Ada");
  rememberSessionName("");
  expect(recalledSessionName()).toBe("");
});
