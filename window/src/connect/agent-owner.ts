// Gateway methods that need an owning Trunk once more than one Trunk exists. Without an agentId the engine
// refuses them ("Multiple agents are configured, but … has no explicit owner") or, for model auth, answers for
// no one. Sources: engine/src/gateway/server-methods/model-auth-agent-scope.ts (resolveModelAuthAgentScope),
// skills-workspace-handler.ts (resolveSkillsAgentWorkspace), memory-search.ts and memory-provider.ts.
const OWNED = new Set([
  "models.authStatus",
  "models.authSetApiKey",
  "models.authLogout",
  "models.authOrderSet",
  "models.authRefresh",
  "models.authLogin",
  "models.probe",
  "webSearch.status",
  "webSearch.test",
  "skills.workshop.read",
  "skills.install",
  "skills.update",
  "skills.securityVerdicts",
  "skills.skillCard",
  "memory.search",
  "memory.get",
  "memory.status",
]);

export function needsOwner(method: string): boolean {
  return OWNED.has(method) || method.startsWith("skills.proposals.");
}

/** Adds the default Trunk as owner when an owned call names none (an empty agentId counts as none). */
export function withOwner(method: string, params: unknown, agentId: string | undefined): unknown {
  if (!agentId || !needsOwner(method)) return params;
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) return params;
  const record = (params ?? {}) as Record<string, unknown>;
  if (typeof record.agentId === "string" && record.agentId.trim()) return params;
  return { ...record, agentId };
}
