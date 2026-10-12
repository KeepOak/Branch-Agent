// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/config/sandbox_config.py (atlas SAFETY-0044)
/**
 * Outbound network policy for locally managed Docker sandboxes.
 *
 * open keeps the configured Docker networking; isolated denies all egress through the
 * policy proxy; allowlist permits configured domains plus optional runtime approval.
 */
import net from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";

export const SANDBOX_NETWORK_MODES = ["open", "isolated", "allowlist"] as const;
export const SANDBOX_NETWORK_APPROVALS = ["deny", "prompt"] as const;
export type SandboxNetworkMode = (typeof SANDBOX_NETWORK_MODES)[number];
export type SandboxNetworkApproval = (typeof SANDBOX_NETWORK_APPROVALS)[number];

/** Official Node runtime image for the trusted sidecar; the proxy script is installed at start. */
export const DEFAULT_SANDBOX_NETWORK_PROXY_IMAGE = "node:24-alpine";
export const DEFAULT_SANDBOX_NETWORK_TEMPORARY_GRANT_TTL = 300;

function invalidAllowDomain(raw: string): Error {
  return new Error(`invalid sandbox network allowlist domain: ${JSON.stringify(raw)}`);
}

function hasInvalidAllowDomainShape(value: string, suffix: string): boolean {
  return (
    !value ||
    value === "*" ||
    !suffix ||
    value.includes("://") ||
    value.includes("/") ||
    value.includes(":") ||
    suffix.includes("*") ||
    suffix.startsWith(".") ||
    suffix.endsWith(".")
  );
}

function isValidAsciiDomain(ascii: string): boolean {
  const labels = ascii.split(".");
  return (
    labels.length >= 2 &&
    ascii.length <= 253 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        /^[A-Za-z0-9-]+$/u.test(label),
    )
  );
}

/** Returns the canonical exact or leading-wildcard rule, or throws for unsafe rules. */
export function canonicalizeSandboxNetworkAllowDomain(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\.+$/u, "");
  const wildcard = value.startsWith("*.");
  const suffix = wildcard ? value.slice(2) : value;
  if (hasInvalidAllowDomainShape(value, suffix) || net.isIP(suffix) !== 0) {
    throw invalidAllowDomain(raw);
  }
  // oxlint-disable-next-line no-control-regex -- the ASCII range selects IDNA conversion.
  const ascii = /^[\x00-\x7f]*$/u.test(suffix) ? suffix : domainToASCII(suffix);
  if (!ascii || !isValidAsciiDomain(ascii)) {
    throw invalidAllowDomain(raw);
  }
  return (wildcard ? "*." : "") + ascii;
}

export function normalizeSandboxNetworkAllowDomains(values: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const canonical = canonicalizeSandboxNetworkAllowDomain(raw);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return normalized;
}

export const SandboxNetworkPolicySchema = z
  .strictObject({
    mode: z.enum(SANDBOX_NETWORK_MODES).optional(),
    allowDomains: z.array(z.string()).optional(),
    approval: z.enum(SANDBOX_NETWORK_APPROVALS).optional(),
    temporaryGrantTtl: z.number().int().min(30).max(3600).optional(),
    proxyImage: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    for (const [index, domain] of (data.allowDomains ?? []).entries()) {
      try {
        canonicalizeSandboxNetworkAllowDomain(domain);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowDomains", index],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

export type SandboxNetworkPolicySettings = z.output<typeof SandboxNetworkPolicySchema>;

export type ResolvedSandboxNetworkPolicy = {
  mode: SandboxNetworkMode;
  allowDomains: string[];
  approval: SandboxNetworkApproval;
  temporaryGrantTtl: number;
  proxyImage: string;
};

/** Applies upstream defaults: open mode, no domains, prompt approval, five-minute grants. */
export function resolveSandboxNetworkPolicy(
  settings: SandboxNetworkPolicySettings | undefined,
): ResolvedSandboxNetworkPolicy {
  return {
    mode: settings?.mode ?? "open",
    allowDomains: normalizeSandboxNetworkAllowDomains(settings?.allowDomains ?? []),
    approval: settings?.approval ?? "prompt",
    temporaryGrantTtl: settings?.temporaryGrantTtl ?? DEFAULT_SANDBOX_NETWORK_TEMPORARY_GRANT_TTL,
    proxyImage: settings?.proxyImage ?? DEFAULT_SANDBOX_NETWORK_PROXY_IMAGE,
  };
}
