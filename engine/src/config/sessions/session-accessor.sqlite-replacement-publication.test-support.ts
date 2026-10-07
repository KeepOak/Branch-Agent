import { afterEach, vi } from "vitest";

// The canonical executor still owns real SQL, admission, and settlement; only reply delivery changes.
const delivery = vi.hoisted(() => ({
  afterResult: undefined as (() => void | Promise<void>) | undefined,
  releaseFailure: undefined as Error | undefined,
  afterRelease: undefined as (() => Promise<void>) | undefined,
}));

export function getReplacementPublicationDelivery() {
  return delivery;
}

vi.mock("../../state/branch-agent-execution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/branch-agent-execution.js")>();
  return {
    ...actual,
    captureBranchAgentDatabaseExecution: (
      ...args: Parameters<typeof actual.captureBranchAgentDatabaseExecution>
    ): ReturnType<typeof actual.captureBranchAgentDatabaseExecution> => {
      const owned = actual.captureBranchAgentDatabaseExecution(...args);
      return {
        ...owned,
        runExisting: (source, operation, options) =>
          owned.runExisting(
            source,
            (scope) =>
              operation({
                execute: async (command, commandOptions) => {
                  const result = await scope.execute(command, commandOptions);
                  if (command.type === "session.entries.replace") {
                    await delivery.afterResult?.();
                  }
                  return result;
                },
              }),
            options,
          ),
        release: async () => {
          await owned.release();
          const afterRelease = delivery.afterRelease;
          delivery.afterRelease = undefined;
          await afterRelease?.();
          if (delivery.releaseFailure) {
            throw delivery.releaseFailure;
          }
        },
      };
    },
  };
});

afterEach(() => {
  delivery.afterResult = undefined;
  delivery.releaseFailure = undefined;
  delivery.afterRelease = undefined;
});
