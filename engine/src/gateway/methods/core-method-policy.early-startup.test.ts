import { describe, expect, it } from "vitest";
import {
  EARLY_STARTUP_GATEWAY_METHODS,
  STARTUP_UNAVAILABLE_GATEWAY_METHODS,
} from "./core-method-policy.js";

describe("early startup methods", () => {
  it("serves only read-only session reads right after bind", () => {
    expect(EARLY_STARTUP_GATEWAY_METHODS.toSorted()).toEqual(
      ["chat.history", "sessions.list", "sessions.subscribe"].toSorted(),
    );
    for (const method of EARLY_STARTUP_GATEWAY_METHODS) {
      expect(STARTUP_UNAVAILABLE_GATEWAY_METHODS).toContain(method);
    }
  });

  it("keeps sends, run creation and the model catalog behind full readiness", () => {
    for (const method of ["chat.send", "agent", "sessions.create", "models.list"]) {
      expect(EARLY_STARTUP_GATEWAY_METHODS).not.toContain(method);
    }
  });
});
