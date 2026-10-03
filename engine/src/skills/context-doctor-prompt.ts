/** Starts the primary-agent context investigation from letta-code's doctor command. */
export function buildContextDoctorPrompt(input: {
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir: string;
  agentDir?: string;
  provider: string;
  model: string;
  skillFile: string;
  symptom?: string;
}): string {
  return `<system-reminder>
The user invoked /doctor. You are the primary investigator in this conversation.
Read the explicitly selected context-doctor skill at ${input.skillFile} and follow its investigation workflow.
Conduct the investigation here using your normal tools, approvals, and conversation history. Return your findings directly in this conversation.

## Investigation environment

Current agent ID: ${input.agentId}
Investigation session key: ${input.sessionKey ?? "(new session)"}
Investigation conversation ID: ${input.sessionId ?? "(new conversation)"}
Current provider/model: ${input.provider}/${input.model}
Current agent workspace: ${input.workspaceDir}
Workspace memory locations, when present: MEMORY.md and memory/ beneath the workspace.
${input.agentDir ? `Current agent runtime directory: ${input.agentDir}` : "No agent runtime directory was supplied."}
Use sessions_list, sessions_search, and sessions_history for accessible conversation evidence; memory_search and memory_get for indexed memory. Use read for relevant workspace and skill files.
</system-reminder>

User request: ${input.symptom?.trim() || "/doctor"}`;
}
