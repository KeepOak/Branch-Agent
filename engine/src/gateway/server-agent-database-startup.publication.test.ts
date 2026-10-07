import { describe, expect, it } from "vitest";
import { AgentDatabasePreparationSupersededError } from "../state/agent-database-admission.js";
import { runStartupModelPublication } from "./server-agent-database-startup.js";

class PublicationSupersededError extends Error {}

describe("runStartupModelPublication", () => {
  it("turns a model publication superseded by a config reload into a retryable preparation supersession", async () => {
    let configRevision = 1;
    const preparedRevision = configRevision;
    const assertPreparationCurrent = () => {
      if (configRevision !== preparedRevision) {
        throw new AgentDatabasePreparationSupersededError(
          "Agent tk startup preparation was superseded",
        );
      }
    };
    const run = runStartupModelPublication(assertPreparationCurrent, async (isCurrent) => {
      configRevision += 1; // a config reload lands while the model runtime publishes
      if (!isCurrent()) {
        throw new PublicationSupersededError("prepared model runtime publication was superseded");
      }
    });
    await expect(run).rejects.toBeInstanceOf(AgentDatabasePreparationSupersededError);
  });

  it("keeps other publication failures as they are", async () => {
    const failure = new Error("model preparation failed");
    await expect(
      runStartupModelPublication(
        () => {},
        async (isCurrent) => {
          expect(isCurrent()).toBe(true);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});
