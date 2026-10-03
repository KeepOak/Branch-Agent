import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  // Inject only the existing global routing boundary; retain the real native event consumer.
  if (specifier === "../../infra/agent-events.js" && context.parentURL?.includes("/harness/attempt-events.ts")) {
    return { url: "data:text/javascript,export function emitAgentEvent() {}", shortCircuit: true };
  }
  if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
