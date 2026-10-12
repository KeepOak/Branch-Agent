import fs from "node:fs";
import path from "node:path";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";

export function createUpdateStateProfileInitializer(
  fixtureRoot: string,
): (env?: NodeJS.ProcessEnv) => void {
  const preparedStateDatabase = path.join(fixtureRoot, "prepared-state.sqlite");
  // Ordinary update cases model the existing schema advertised by their inspection fixture.
  return (env = process.env) => {
    const databasePath = resolveBranchStateSqlitePath(env);
    if (!fs.existsSync(databasePath) && fs.existsSync(preparedStateDatabase)) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(preparedStateDatabase, databasePath);
      return;
    }
    const database = openBranchStateDatabase({ env });
    closeBranchStateDatabaseForTest();
    // Bootstrap once; every profile owns a separate writable copy of the closed database.
    if (!fs.existsSync(preparedStateDatabase)) {
      fs.copyFileSync(database.path, preparedStateDatabase);
    }
  };
}
