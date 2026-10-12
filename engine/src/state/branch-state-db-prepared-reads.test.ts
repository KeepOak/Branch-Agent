import { constants } from "node:sqlite";
import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { withExistingBranchStateDatabaseReadOnly } from "./branch-state-db-readonly.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { assertBranchStateWriteAllowed } from "./branch-state-ownership.js";

it("keeps prepared queries reusable across ordinary reads and ownership checks", async () => {
  await withBranchTestState({ label: "state-prepared-reads" }, async ({ env }) => {
    const { db, path } = openBranchStateDatabase({ env });
    db.exec("CREATE TABLE prepared_read (value INTEGER); INSERT INTO prepared_read VALUES (42)");
    let readPreparations = 0;
    db.setAuthorizer((action, table) => {
      if (action === constants.SQLITE_READ && table === "prepared_read") {
        readPreparations++;
      }
      return constants.SQLITE_OK;
    });
    const read = db.prepare("SELECT value FROM prepared_read");
    expect(read.get()).toEqual({ value: 42 });
    expect(readPreparations).toBe(1);

    for (let iteration = 0; iteration < 3; iteration++) {
      expect(withExistingBranchStateDatabaseReadOnly(() => read.get(), { env })).toEqual({
        value: 42,
      });
      assertBranchStateWriteAllowed({ database: db, databasePath: path, env });
      expect(read.get()).toEqual({ value: 42 });
    }

    expect(readPreparations).toBe(1);
  });
});
