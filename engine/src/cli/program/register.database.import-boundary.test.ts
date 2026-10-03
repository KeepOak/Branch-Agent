import { expect, it } from "vitest";
import { findSourceImportBackedges } from "../../../test/helpers/source-import-closure.js";

it("keeps database registration independent of schema and ownership operation runtimes", () => {
  expect(
    findSourceImportBackedges("src/cli/program/register.database.ts", [
      "src/state/branch-agent-schema-inspection.ts",
      "src/state/branch-database-preflight.ts",
      "src/state/branch-state-db-maintenance.ts",
      "src/state/branch-state-ownership-operations.ts",
      "src/state/branch-state-ownership.ts",
    ]),
  ).toEqual([]);
});
