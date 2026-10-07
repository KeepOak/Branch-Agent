import { describe, expect, it } from "vitest";
import { withEnv } from "../../src/test-utils/env.js";
import { assertSqliteFlipStartupRefusal } from "./sqlite-sessions-transcripts-flip-proof-assertions.js";

function startupRefusal(command: string) {
  return {
    message: `gateway refused startup: legacy migration required (code=78 signal=null)
Legacy session store requires migration: /qa/state/agents/main/sessions/sessions.json. Run "${command}" against the same state/config before starting Branch.`,
    preservedSourceFiles: [
      "agents/main/sessions/sessions.json",
      "agents/main/sessions/archive-fixture/cold-archive.jsonl",
      "agents/main/sessions/sqlite-legacy-main.jsonl",
    ],
  };
}

describe("SQLite flip proof startup refusal assertions", () => {
  it.each([
    [undefined, "branch doctor --fix", undefined],
    ["qa-sqlite-proof", "branch --profile qa-sqlite-proof doctor --fix", undefined],
    ["qa-sqlite-proof", "branch doctor --fix", "guidance"],
    ["qa-sqlite-proof", "branch --profile unrelated doctor --fix", "guidance"],
    [undefined, "branch doctor --fix", "source"],
  ] as const)("validates profile %s guidance %s with failure %s", (profile, command, failure) => {
    withEnv({ BRANCH_PROFILE: profile, BRANCH_CONTAINER_HINT: undefined }, () => {
      const refusal = startupRefusal(command);
      if (failure === "source") {
        refusal.preservedSourceFiles.pop();
      }
      const assertion = expect(() => assertSqliteFlipStartupRefusal(refusal));
      if (failure) {
        assertion.toThrow(
          expect.objectContaining(
            failure === "guidance"
              ? {
                  actual: refusal.message,
                  expected: 'Run "branch --profile qa-sqlite-proof doctor --fix"',
                }
              : { actual: refusal.preservedSourceFiles },
          ),
        );
      } else {
        assertion.not.toThrow();
      }
    });
  });
});
