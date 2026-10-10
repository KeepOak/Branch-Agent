import { describe, expect, it } from "vitest";
import { foundState } from "./coding-apps";

const CODEX = { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" };
const CLAUDE = { kind: "claude-cli", brand: "anthropic", name: "Claude Code" };

describe("coding app state", () => {
  it("counts a saved ChatGPT sign-in as ready for Codex when the app is not installed", () => {
    expect(foundState(CODEX, { candidates: [], unavailableCandidates: [] }, true)).toEqual({ state: "ready", viaSignIn: true });
  });

  it("still says not found for Codex with no app and no sign-in", () => {
    expect(foundState(CODEX, { candidates: [], unavailableCandidates: [] }, false).state).toBe("missing");
  });

  it("never treats a saved ChatGPT sign-in as Claude Code", () => {
    expect(foundState(CLAUDE, { candidates: [], unavailableCandidates: [] }, true).state).toBe("missing");
  });
});
