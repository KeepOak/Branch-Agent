import { afterAll, describe, expect, it } from "vitest";
import { findSqliteTransactionBoundaryViolations } from "../../scripts/check-sqlite-transaction-boundary.mts";
import { createNativeTypeScriptParser } from "../../scripts/lib/native-typescript.mts";

const parser = createNativeTypeScriptParser();
afterAll(() => parser.close());

function parseFixture(content: string) {
  return [content, "source.ts", parser.parseSourceFile("source.ts", content)] as const;
}

describe("SQLite transaction boundary guard", () => {
  it("rejects removed async transaction primitives", () => {
    expect(
      findSqliteTransactionBoundaryViolations(
        ...parseFixture(`
        import { runSqliteImmediateTransactionAsync } from "./sqlite-transaction.js";
        export async function runBranchAgentWriteTransactionAsync() {}
        await database.runSqliteImmediateTransactionAsync(async () => undefined);
      `),
      ),
    ).toEqual([
      {
        line: 2,
        reason:
          'imports removed async SQLite transaction primitive "runSqliteImmediateTransactionAsync"',
      },
      {
        line: 3,
        reason:
          'declares removed async SQLite transaction primitive "runBranchAgentWriteTransactionAsync"',
      },
      {
        line: 4,
        reason:
          'calls removed async SQLite transaction primitive "runSqliteImmediateTransactionAsync"',
      },
    ]);
  });

  it("rejects inline async callbacks passed to synchronous transaction helpers", () => {
    expect(
      findSqliteTransactionBoundaryViolations(
        ...parseFixture(`
        runSqliteImmediateTransactionSync(db, async () => await prepare());
        runBranchAgentWriteTransaction(async (database) => await write(database), options);
        runBranchStateWriteTransaction(async (database) => await write(database));
        await runBranchAgentWriteWithYieldingAdmission(async (database) => await write(database), options);
      `),
      ),
    ).toEqual([
      {
        line: 2,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
      {
        line: 3,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runBranchAgentWriteTransaction"',
      },
      {
        line: 4,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runBranchStateWriteTransaction"',
      },
      {
        line: 5,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runBranchAgentWriteWithYieldingAdmission"',
      },
    ]);
  });

  it("rejects local async function references passed as callbacks", () => {
    expect(
      findSqliteTransactionBoundaryViolations(
        ...parseFixture(`
        async function writeRows() {}
        const writeAgentRows = async () => undefined;
        runSqliteImmediateTransactionSync(db, writeRows);
        runBranchAgentWriteTransaction(writeAgentRows, options);
      `),
      ),
    ).toEqual([
      {
        line: 4,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
      {
        line: 5,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runBranchAgentWriteTransaction"',
      },
    ]);
  });

  it("tracks aliases of synchronous transaction imports", () => {
    expect(
      findSqliteTransactionBoundaryViolations(
        ...parseFixture(`
        import { runSqliteImmediateTransactionSync as transact } from "./sqlite-transaction.js";
        transact(db, async () => undefined);
      `),
      ),
    ).toEqual([
      {
        line: 3,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
    ]);
  });

  it("allows asynchronous preparation followed by a synchronous commit callback", () => {
    expect(
      findSqliteTransactionBoundaryViolations(
        ...parseFixture(`
        const prepared = await prepareMutation();
        runBranchAgentWriteTransaction((database) => {
          validate(database, prepared.expected);
          apply(database, prepared.patch);
        }, options);
        await runBranchAgentWriteWithYieldingAdmission((database) => {
          validate(database, prepared.expected);
          apply(database, prepared.patch);
        }, options);
      `),
      ),
    ).toEqual([]);
  });
});
