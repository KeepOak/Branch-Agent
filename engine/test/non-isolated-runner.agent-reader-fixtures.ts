import path from "node:path";

export function agentReaderFixtureFiles(
  repoRoot: string,
  fixtureRoot: string,
): Record<string, string> {
  const source = (name: string) => JSON.stringify(path.join(repoRoot, "src", name));
  const imports = `import type { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it, vi } from "vitest";
import { resolveGlobalSingleton } from ${source("shared/global-singleton.ts")};
import { hasBranchAgentDatabaseAsyncResources } from ${source("state/branch-agent-db-resources.ts")};
const root = ${JSON.stringify(path.join(fixtureRoot, "agent-reader-state"))};
const probeKey = Symbol.for("fixture.agentReader");
const probe = resolveGlobalSingleton<{ reader?: DatabaseSync; afterAllReached: boolean }>(
  probeKey,
  () => ({ afterAllReached: false }),
);
`;
  return {
    "11-a-agent-reader.test.ts": `${imports}
import { openBranchAgentDatabase } from ${source("state/branch-agent-db.ts")};
import { closeBranchAgentDatabaseByPathAsync } from ${source("state/branch-agent-db-lifecycle.ts")};
import { withBranchAgentDatabaseReadOnly } from ${source("state/branch-agent-db-readonly.ts")};
vi.mock(${source("state/branch-agent-db-lifecycle.ts")}, async (importOriginal) => ({
  ...await importOriginal<typeof import(${source("state/branch-agent-db-lifecycle.ts")})>(),
  closeBranchAgentDatabasesAsync: async () => {},
}));
it("retains an ordinary agent reader through file completion", async () => {
  const options = { agentId: "main", env: { BRANCH_STATE_DIR: root } };
  const writer = openBranchAgentDatabase(options);
  await closeBranchAgentDatabaseByPathAsync(writer.path);
  expect(writer.db.isOpen).toBe(false);
  const read = withBranchAgentDatabaseReadOnly(({ db }) => db, options);
  expect(read.found).toBe(true);
  if (!read.found) {
    throw new Error("Missing synthetic agent database");
  }
  probe.reader = read.value;
  expect(probe.reader.isOpen).toBe(true);
  expect(hasBranchAgentDatabaseAsyncResources()).toBe(true);
});
afterAll(() => {
  expect(probe.reader?.isOpen, "cached reader must remain open through afterAll").toBe(true);
  probe.afterAllReached = true;
});
`,
    "11-b-agent-reader.test.ts": `${imports}
it("retires the prior file's cached agent reader and resources", async () => {
  try {
    expect(probe.afterAllReached, "producer afterAll must precede B in the same worker").toBe(true);
    expect(probe.reader?.isOpen, "prior cached reader must close during runner drain").toBe(false);
    expect(hasBranchAgentDatabaseAsyncResources(), "prior agent resources must retire before B").toBe(false);
  } finally {
    const lifecycle = await vi.importActual<typeof import(${source("state/branch-agent-db-lifecycle.ts")})>(${source("state/branch-agent-db-lifecycle.ts")});
    await lifecycle.closeBranchAgentDatabasesAsync(root);
    Reflect.deleteProperty(globalThis, probeKey);
  }
});
`,
  };
}
