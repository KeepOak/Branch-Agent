// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/agent/agent.py (atlas AGENT-LOOP-0089). Converted to TypeScript for the production tool loop.
export function unknownToolFeedback(name: string, available: string[]): string {
  return `Tool '${name}' not found. Available: ${JSON.stringify(available)}`;
}

export function invalidArgumentsFeedback(name: string, args: unknown, error: unknown): string {
  const params = args !== null && typeof args === "object" && !Array.isArray(args)
    ? `Parameters provided: ${JSON.stringify(Object.keys(args))}`
    : "Arguments: unparseable JSON";
  // Native schema errors may include the input value. Preserve diagnostics without echoing it.
  let reason = error instanceof Error ? error.message : String(error);
  if (args !== null && typeof args === "object") {
    for (const value of Object.values(args)) {
      if (typeof value === "string" && value) reason = reason.split(value).join("[value]");
    }
  }
  return `Error validating tool '${name}': ${reason}. ${params}`;
}
