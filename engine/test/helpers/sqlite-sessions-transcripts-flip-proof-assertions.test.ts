import { describe, expect, it } from "vitest";
import { withEnv } from "../../src/test-utils/env.js";
import { assertSqliteFlipStartupRefusal } from "./sqlite-sessions-transcripts-flip-proof-assertions.js";

function startupRefusal(command: string) {
  return {
    message: `gateway refused startup: legacy migration required (code=78 signal=null)
Legacy session store requires migration: /qa/state/sessions/sessions.json. Run "${command}" against the same state/config before starting Branch.`,
    preservedSourceFiles: [
      "agents/main/sessions/sessions.json",
      "agents/main/sessions/archive-fixture/cold-archive.jsonl",
      "sessions/sessions.json",
    ],
  };
}

describe("SQLite flip proof startup refusal assertions", () => {
  it.each([
    { label: "unprofiled", profile: undefined, command: "branch doctor --fix" },
    {
      label: "profile-qualified",
      profile: "qa-sqlite-proof",
      command: "branch --profile qa-sqlite-proof doctor --fix",
    },
  ])("accepts $label guidance with preserved legacy sources", ({ profile, command }) => {
    withEnv({ BRANCH_PROFILE: profile, BRANCH_CONTAINER_HINT: undefined }, () => {
      expect(() => assertSqliteFlipStartupRefusal(startupRefusal(command))).not.toThrow();
    });
  });

  it.each(["branch doctor --fix", "branch --profile unrelated doctor --fix"])(
    "rejects guidance outside the active profile: %s",
    (command) => {
      withEnv({ BRANCH_PROFILE: "qa-sqlite-proof", BRANCH_CONTAINER_HINT: undefined }, () => {
        const refusal = startupRefusal(command);
        expect(() => assertSqliteFlipStartupRefusal(refusal)).toThrow(
          expect.objectContaining({
            actual: refusal.message,
            expected: 'Run "branch --profile qa-sqlite-proof doctor --fix"',
          }),
        );
      });
    },
  );

  it("rejects valid guidance when a legacy source was not preserved", () => {
    withEnv({ BRANCH_PROFILE: undefined, BRANCH_CONTAINER_HINT: undefined }, () => {
      const refusal = startupRefusal("branch doctor --fix");
      refusal.preservedSourceFiles.pop();
      expect(() => assertSqliteFlipStartupRefusal(refusal)).toThrow(
        expect.objectContaining({ actual: refusal.preservedSourceFiles }),
      );
    });
  });
});
