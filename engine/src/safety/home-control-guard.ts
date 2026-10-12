// Home Assistant lock guard (atlas AUTOMATION-0172, R-1615 extending RES-109): scripts, scenes and automations can
// open the house, so they ask every time just like the lock domain; command-running integrations are refused even
// when the owner lists them. Looks at the called domain and every targeted entity's domain.

/** Ask every time, never "once only". */
export const HOME_ALWAYS_ASK_DOMAINS: ReadonlySet<string> = new Set([
  "lock",
  "alarm_control_panel",
  "script",
  "scene",
  "automation",
]);

/** Refused even when listed: they run arbitrary commands or reach outside Home Assistant. */
export const HOME_HARD_DENY_DOMAINS: ReadonlySet<string> = new Set([
  "shell_command",
  "command_line",
  "python_script",
  "pyscript",
  "hassio",
  "rest_command",
]);

export type HomeCall = Readonly<{
  /** "script.turn_on", "lock.unlock", "homeassistant.turn_on", ... */
  service: string;
  entityIds?: readonly string[];
}>;

export type HomeDecision =
  | { outcome: "allow" }
  | { outcome: "ask"; remember: false; why: string }
  | { outcome: "deny"; why: string };

function domainOf(id: string): string {
  return id.split(".", 1)[0]?.trim().toLowerCase() ?? "";
}

/** Decide one Home Assistant service call against the owner's allowed domains. */
export function decideHomeCall(call: HomeCall, allowedDomains: ReadonlySet<string>): HomeDecision {
  const domains = [domainOf(call.service), ...(call.entityIds ?? []).map(domainOf)];
  const hardDenied = domains.find((d) => HOME_HARD_DENY_DOMAINS.has(d));
  if (hardDenied) {
    return { outcome: "deny", why: `${hardDenied} can run commands, so Branch never calls it` };
  }
  const notAllowed = domains.find((d) => !allowedDomains.has(d));
  if (notAllowed) {
    return { outcome: "deny", why: `${notAllowed} is not on your allowed list` };
  }
  const sensitive = domains.find((d) => HOME_ALWAYS_ASK_DOMAINS.has(d));
  if (sensitive) {
    return { outcome: "ask", remember: false, why: `${sensitive} can open the house` };
  }
  return { outcome: "allow" };
}
