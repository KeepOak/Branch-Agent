/** Cross-platform daemon service names, labels, and profile-aware descriptions. */
import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";

// Default service labels (canonical + legacy compatibility)
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.branch.gateway";
const GATEWAY_SYSTEMD_SERVICE_NAME = "branch-gateway";
const GATEWAY_WINDOWS_TASK_NAME = "Branch Agent Gateway";
export const GATEWAY_SERVICE_MARKER = "branch";
export const GATEWAY_SERVICE_KIND = "gateway";
export const GATEWAY_SERVICE_RUNTIME_PID_ENV = "BRANCH_GATEWAY_SERVICE_PID";
export const GATEWAY_SERVICE_SELECTOR_ENV_KEYS = [
  "BRANCH_STATE_DIR",
  "BRANCH_CONFIG_PATH",
  "BRANCH_PROFILE",
  "BRANCH_GATEWAY_PORT",
  "BRANCH_LAUNCHD_LABEL",
  "BRANCH_SYSTEMD_UNIT",
  "BRANCH_WINDOWS_TASK_NAME",
] as const;

export function isGatewayServiceEnv(env: Record<string, string | undefined>): boolean {
  if (env.BRANCH_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER) {
    return false;
  }
  const serviceKind = env.BRANCH_SERVICE_KIND?.trim();
  return !serviceKind || serviceKind === GATEWAY_SERVICE_KIND;
}

const NODE_LAUNCH_AGENT_LABEL = "ai.branch.node";
const NODE_SYSTEMD_SERVICE_NAME = "branch-node";
const NODE_WINDOWS_TASK_NAME = "Branch Agent Node";
const NODE_SERVICE_MARKER = "branch";
export const NODE_SERVICE_KIND = "node";
const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = ["clawdbot-gateway"];

function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || normalizeLowercaseStringOrEmpty(trimmed) === "default") {
    // The default profile keeps the historical unqualified service names.
    return null;
  }
  return trimmed;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.branch.${normalized}`;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  return `${GATEWAY_SYSTEMD_SERVICE_NAME}${resolveGatewayProfileSuffix(profile)}`;
}

function isAmbiguousLegacyGatewayCandidate(legacyName: string): boolean {
  // branch-node is the Node service. branch-gateway and
  // branch-gateway-<profile> are canonical gateway names for default or
  // another profile (node -> branch-node, gateway -> branch-gateway,
  // gateway-lisa -> branch-gateway-lisa).
  return (
    legacyName === NODE_SYSTEMD_SERVICE_NAME ||
    legacyName === GATEWAY_SYSTEMD_SERVICE_NAME ||
    legacyName.startsWith(`${GATEWAY_SYSTEMD_SERVICE_NAME}-`)
  );
}

/**
 * Service-name candidates for a profile, preferred order.
 *
 * Current installs use `branch-gateway[-profile]`. Older multi-agent hosts
 * used `branch-<profile>` (no "gateway" segment). Doctor/runtime resolution
 * must try both for the same profile before scanning unrelated units.
 */
export function resolveGatewaySystemdServiceNameCandidates(profile?: string): string[] {
  const canonical = resolveGatewaySystemdServiceName(profile);
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    // Default profile: branch-gateway is current; bare branch is a known
    // legacy system-unit name (parallel to branch-<profile> for named agents).
    // Custom names are matched separately against their effective installation identity.
    return [canonical, "branch"];
  }
  const legacy = `branch${suffix}`;
  if (isAmbiguousLegacyGatewayCandidate(legacy)) {
    return [canonical];
  }
  return [canonical, legacy];
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `Branch Agent Gateway (${normalized})`;
}

export function normalizeWindowsTaskIdentity(value: string): string {
  // Root prefixes and casing do not change task identity; nested folders do.
  return value.replace(/^\\+/, "").toLowerCase();
}

type GatewayNativeServiceIdentityConflict = {
  envKey: "BRANCH_LAUNCHD_LABEL" | "BRANCH_SYSTEMD_UNIT" | "BRANCH_WINDOWS_TASK_NAME";
  expected: string;
};

export function resolveGatewayNativeServiceIdentityConflict(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): GatewayNativeServiceIdentityConflict | null {
  const profile = normalizeGatewayProfile(env.BRANCH_PROFILE);
  if (!profile) {
    return null;
  }

  if (platform === "darwin") {
    const envKey = "BRANCH_LAUNCHD_LABEL";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayLaunchAgentLabel(profile);
    return actual && actual !== expected ? { envKey, expected } : null;
  }
  if (platform === "linux") {
    const envKey = "BRANCH_SYSTEMD_UNIT";
    const actual = env[envKey]?.trim();
    const normalizedActual = actual?.endsWith(".service") ? actual : actual && `${actual}.service`;
    const expected = `${resolveGatewaySystemdServiceName(profile)}.service`;
    return normalizedActual && normalizedActual !== expected ? { envKey, expected } : null;
  }
  if (platform === "win32") {
    const envKey = "BRANCH_WINDOWS_TASK_NAME";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayWindowsTaskName(profile);
    return actual && normalizeWindowsTaskIdentity(actual) !== normalizeWindowsTaskIdentity(expected)
      ? { envKey, expected }
      : null;
  }
  return null;
}

function formatGatewayServiceDescription(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return "Branch Agent Gateway";
  }
  return `Branch Agent Gateway (profile: ${normalized})`;
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  description?: string;
}): string {
  return params.description ?? formatGatewayServiceDescription(params.env.BRANCH_PROFILE);
}

export function resolveNodeLaunchAgentLabel(): string {
  return NODE_LAUNCH_AGENT_LABEL;
}

export function resolveNodeSystemdServiceName(): string {
  return NODE_SYSTEMD_SERVICE_NAME;
}

export function resolveNodeWindowsTaskName(): string {
  return NODE_WINDOWS_TASK_NAME;
}

export function resolveNodeServiceIdentityEnvironment(): Record<string, string> {
  return {
    BRANCH_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    BRANCH_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    BRANCH_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    BRANCH_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
    BRANCH_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    BRANCH_LOG_PREFIX: "node",
    BRANCH_SERVICE_MARKER: NODE_SERVICE_MARKER,
    BRANCH_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}
