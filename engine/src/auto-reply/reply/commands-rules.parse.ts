import { matchCommandPrefix } from "./command-gates.js";

export type RulesCommand =
  | { action: "list" }
  | { action: "toggle"; provider: "cursor" | "windsurf"; path: string; enabled: boolean }
  | { action: "error"; message: string };

export function parseRulesCommand(body: string): RulesCommand | null {
  const args = matchCommandPrefix(body, "/rules");
  if (args === null) return null;
  if (!args || args === "list") return { action: "list" };
  const match = args.match(/^(cursor|windsurf)\s+(on|off)\s+(.+)$/u);
  if (!match)
    return {
      action: "error",
      message: "Usage: /rules [list] or /rules cursor|windsurf on|off <relative rule path>",
    };
  return {
    action: "toggle",
    provider: match[1] as "cursor" | "windsurf",
    enabled: match[2] === "on",
    path: match[3]!.trim().replace(/^\.\//u, ""),
  };
}
