/** Whether a plugin harness constructs Branch Agent tools inside its runtime. */
export function agentHarnessBuildsBranchTools(harnessId: string): boolean {
  return harnessId === "codex" || harnessId === "copilot";
}

/** Whether the selected harness exposes Branch Agent's agent-tool surface. */
export function agentHarnessExposesBranchTools(harnessId: string): boolean {
  return harnessId === "branch" || agentHarnessBuildsBranchTools(harnessId);
}
