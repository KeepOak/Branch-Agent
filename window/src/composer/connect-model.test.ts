import { describe, expect, it } from "vitest";
import { CONNECT_MODEL_ANSWERS, friendlyModelError, inferenceProblem, isNoUsableModelError, NO_MODEL_SETUP } from "./connect-model";

describe("no usable model copy", () => {
  it("maps engine failures to the same words, never the raw error", () => {
    expect(isNoUsableModelError('No API key found for provider "openai".')).toBe(true);
    expect(isNoUsableModelError("401 Missing bearer or basic authentication in header")).toBe(true);
    expect(isNoUsableModelError("Install and sign in to Codex on this computer, then check again.")).toBe(true);
    expect(isNoUsableModelError("Branch Agent could not verify a usable inference route. Check model setup and try again.")).toBe(true);
    expect(isNoUsableModelError("Branch Agent requires working inference: no route")).toBe(true);
    expect(isNoUsableModelError("socket hang up")).toBe(false);
    expect(isNoUsableModelError(CONNECT_MODEL_ANSWERS)).toBe(true);
    expect(isNoUsableModelError(`${CONNECT_MODEL_ANSWERS} (2 files weren't sent)`)).toBe(true);
    expect(friendlyModelError(CONNECT_MODEL_ANSWERS)).toBe(CONNECT_MODEL_ANSWERS);
    expect(friendlyModelError("CodexNotInstalledError: Install and sign in to Codex on this computer, then check again.")).toBe(CONNECT_MODEL_ANSWERS);
    expect(inferenceProblem(new Error("could not verify a usable inference route"))).toBe(CONNECT_MODEL_ANSWERS);
    expect(inferenceProblem(new Error("timed out"))).toBeNull();
    expect(NO_MODEL_SETUP).toBe("No model is set up");
  });
});
