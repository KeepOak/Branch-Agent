import fs from "node:fs";
import path from "node:path";
import {
  closeBranchAgentDatabases,
  openBranchAgentDatabase,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

const options = {
  agentId: process.argv[2] ?? "worker",
  path: process.argv[3] || undefined,
};
const fixtureRoot = process.argv[4];
if (fixtureRoot) {
  const root = process.env.BRANCH_STATE_DIR;
  if (!root || !path.isAbsolute(root) || fs.realpathSync.native(root) !== fixtureRoot) {
    throw new Error("Held database fixture requires its explicit private state root");
  }
  const databasePath = resolveBranchAgentSqlitePath(options);
  const relative = path.relative(fixtureRoot, fs.realpathSync.native(databasePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Held database fixture must stay inside its private state root");
  }
}
const database = openBranchAgentDatabase(options);
process.send?.("ready");
process.on("message", (message) => {
  if (message === "begin-write") {
    database.db.exec(
      "BEGIN IMMEDIATE; INSERT INTO auth_profile_state VALUES ('killed-write', '{}', 1)",
    );
    process.send?.("writing");
    return;
  }
  closeBranchAgentDatabases();
  closeBranchStateDatabaseForTest();
  process.disconnect?.();
});
