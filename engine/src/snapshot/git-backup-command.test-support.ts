import { backupGitCreateCommand } from "../commands/backup-git.js";
import { defaultRuntime } from "../runtime.js";
import { closeBranchAgentDatabasesAsync } from "../state/branch-agent-db.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";

try {
  const agentId = process.argv[3];
  await backupGitCreateCommand(defaultRuntime, {
    repository: process.argv[2],
    ...(agentId ? { agents: [agentId] } : { all: true }),
    json: true,
  });
} finally {
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
}
