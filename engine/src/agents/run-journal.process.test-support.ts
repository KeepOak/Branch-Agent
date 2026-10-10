import { closeBranchAgentDatabases, openBranchAgentDatabase } from "../state/branch-agent-db.js";
import { RunJournal } from "./run-journal.js";

const [stateDir, agentId, mode] = process.argv.slice(2);
if (!stateDir || !agentId) {
  throw new Error("Journal fixture needs a scratch root and Trunk id.");
}
const database = { agentId, env: { ...process.env, BRANCH_STATE_DIR: stateDir } };
const journal = new RunJournal({
  database,
  runId: `${agentId}-run`,
  sessionId: `${agentId}-session`,
  snapshotId: "pinned-snapshot",
});
journal.record(
  {
    type: "tool_execution_start",
    toolName: "fixture",
    toolCallId: "call-1",
    args: {},
  },
  [],
);
const { db } = openBranchAgentDatabase(database);
process.send?.("ready");
process.on("message", (message) => {
  if (message === "hold") {
    db.exec("BEGIN IMMEDIATE");
    // The product append uses a savepoint in this externally held test transaction.
    journal.record(
      {
        type: "tool_execution_end",
        toolName: "fixture",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: "complete" }] },
        isError: false,
      },
      [],
    );
    process.send?.("locked");
  }
  if (message === "release" && mode !== "crash") {
    db.exec("COMMIT");
    journal.end("completed");
    closeBranchAgentDatabases();
    process.disconnect();
  }
});
process.on("disconnect", () => {
  if (db.isOpen && db.isTransaction) {
    db.exec("ROLLBACK");
  }
  closeBranchAgentDatabases();
});
