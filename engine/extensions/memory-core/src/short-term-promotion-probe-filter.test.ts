import { describe, expect, it } from "vitest";
import { isContaminatedRingsSnippet } from "./short-term-promotion-utils.js";

describe("memory promotion of task-local echo probes", () => {
  it.each([
    "User: Reply exactly CODEX_SUBSCRIPTION_OK. Do not call tools.",
    "- User: Return only SMOKE_TEST_PASS",
    "User: Respond exactly READY",
  ])("excludes %s even when transcript promotion is allowed", (snippet) => {
    expect(isContaminatedRingsSnippet(snippet, { allowTranscriptTurnSnippet: true })).toBe(true);
  });
  it.each([
    "User: I prefer concise answers for future code reviews.",
    "User: The integration API must return exactly READY for its health check.",
    "Always reply exactly as the JSON schema specifies when integrating the billing API.",
    "User: My project's current release is READY.",
    "User: Reply only JSON from now on when reviewing API responses.",
    "User: Return exactly the requested format every time you export a report.",
  ])("retains useful context: %s", (snippet) => {
    expect(isContaminatedRingsSnippet(snippet, { allowTranscriptTurnSnippet: true })).toBe(false);
  });
});
