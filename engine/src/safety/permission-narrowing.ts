// tenuo-ai/tenuo@893dbbf473cf2b2b4e49550efe584733322503f3:tenuo-core/src/warrant.rs (atlas SAFETY-0201; changed: attenuation rule ported onto Branch tool policies, no warrants)
// Automation only narrows permissions (atlas SAFETY-0201, SAFETY-0143). Every hand-off — sub-agent, nested flow,
// replayed procedure, resumed work — gets the intersection of what each layer allows, still narrowed by what the
// owner holds now. Idea (attenuation: a delegated warrant can only narrow) from
// tenuo-ai/tenuo@893dbbf473cf2b2b4e49550efe584733322503f3: tenuo-core/src/warrant.rs; tighten-only layering from
// kenryu42/cc-safety-net@acd15d5d5c6dba1a3e979d0db592afc20c463094: src/core/policy/merge.ts. No second matcher:
// tool names go through isToolAllowedByPolicies and exec options through minSecurity/maxAsk.
import type { SandboxToolPolicy } from "../agents/sandbox/types.js";
import { isToolAllowedByPolicies } from "../agents/tool-policy-match.js";
import type { ExecAsk, ExecSecurity } from "../infra/exec-approvals-core.js";
import { maxAsk, minSecurity } from "../infra/exec-approvals-policy.js";
import { asJsonValue, digestOfJson } from "../infra/signed-receipts/canonical-json.js";

export type HeldOr<T> = { status: "ok"; value: T } | { status: "hold"; reason: string };

/**
 * Delegated tool check: allowed only when the parent, the child and the owner's current policy all allow it.
 * A missing parent policy (not yet prepared, e.g. a team task before the team started) holds instead of running open.
 */
export function narrowedToolAllowed(
  name: string,
  layers: {
    parent: SandboxToolPolicy | undefined | null;
    child?: SandboxToolPolicy;
    ownerNow?: SandboxToolPolicy;
  },
): HeldOr<boolean> {
  if (!layers.parent) {
    return { status: "hold", reason: "the parent's permissions are not known yet" };
  }
  return {
    status: "ok",
    value: isToolAllowedByPolicies(name, [layers.parent, layers.child, layers.ownerNow]),
  };
}

export type ExecOption = { security: ExecSecurity; ask: ExecAsk };

/** A per-rule sandbox or approval option composes with the global one and may only tighten it. */
export function composeRuleExecOption(global: ExecOption, rule?: Partial<ExecOption>): ExecOption {
  return {
    security: minSecurity(global.security, rule?.security ?? global.security),
    ask: maxAsk(global.ask, rule?.ask ?? global.ask),
  };
}

export type UnattendedStep = { tool: string; args: unknown };

export type UnattendedYes = Readonly<{
  fingerprint: string;
  maxRuns: number;
  used: number;
  tools: readonly string[];
}>;

function fingerprintSteps(
  steps: readonly UnattendedStep[],
  versions: Readonly<Record<string, string>>,
): string {
  return digestOfJson(asJsonValue({ steps, versions }));
}

/** A separate, capped yes for unattended steps, listing exactly what may run and pinned to the steps and versions. */
export function grantUnattendedYes(params: {
  steps: readonly UnattendedStep[];
  versions: Readonly<Record<string, string>>;
  maxRuns: number;
}): UnattendedYes {
  return Object.freeze({
    fingerprint: fingerprintSteps(params.steps, params.versions),
    maxRuns: Math.max(0, Math.floor(params.maxRuns)),
    used: 0,
    tools: Object.freeze([...new Set(params.steps.map((s) => s.tool))]),
  });
}

/** Re-checks the fingerprint before applying. Any change to steps or versions needs a new yes. */
export function useUnattendedYes(
  yes: UnattendedYes,
  steps: readonly UnattendedStep[],
  versions: Readonly<Record<string, string>>,
): HeldOr<UnattendedYes> {
  if (fingerprintSteps(steps, versions) !== yes.fingerprint) {
    return { status: "hold", reason: "the steps or versions changed since the yes" };
  }
  if (yes.used >= yes.maxRuns) {
    return { status: "hold", reason: "the yes has been used up" };
  }
  return { status: "ok", value: Object.freeze({ ...yes, used: yes.used + 1 }) };
}

/** Saved, immutable record of who a piece of work runs as. Resumed work reads only these, never the UI selection. */
export type ProvenanceRecord = Readonly<{
  identity?: string;
  project?: string;
  workspace?: string;
  policy?: SandboxToolPolicy;
}>;

export type ResumedAuthority = Readonly<{
  identity: string;
  project: string;
  workspace: string;
  depth: number;
  policies: readonly SandboxToolPolicy[];
}>;

export const MAX_RESUME_ANCESTRY = 32;

function firstConflict(chain: readonly ProvenanceRecord[]): string | undefined {
  const root = chain[0];
  for (const record of chain) {
    for (const field of ["identity", "project", "workspace"] as const) {
      if (!record[field]) {
        return `missing ${field}`;
      }
      if (record[field] !== root?.[field]) {
        return `conflicting ${field}`;
      }
    }
    if (!record.policy) {
      return "missing permissions";
    }
  }
  return undefined;
}

/** Resumed, continued or recovered work: authority from the saved chain (root first); ancestry only narrows. */
export function deriveResumedAuthority(
  chain: readonly ProvenanceRecord[],
): HeldOr<ResumedAuthority> {
  if (chain.length === 0 || chain.length > MAX_RESUME_ANCESTRY) {
    return { status: "hold", reason: "the saved ancestry is missing or too deep" };
  }
  const conflict = firstConflict(chain);
  if (conflict) {
    return { status: "hold", reason: conflict };
  }
  const root = chain[0] as Required<ProvenanceRecord>;
  return {
    status: "ok",
    value: Object.freeze({
      identity: root.identity,
      project: root.project,
      workspace: root.workspace,
      depth: chain.length - 1,
      policies: Object.freeze(chain.map((r) => r.policy as SandboxToolPolicy)),
    }),
  };
}

/** A manual procedure replay runs only the exact calls its dialog showed, and still stops on rules and Lockdown. */
export function admitProcedureReplay(params: {
  shown: readonly UnattendedStep[];
  planned: readonly UnattendedStep[];
  lockdown: boolean;
  untrustedFolder: boolean;
  refusedByRule: (step: UnattendedStep) => boolean;
}): HeldOr<true> {
  if (params.lockdown) {
    return { status: "hold", reason: "Lockdown is on" };
  }
  if (params.untrustedFolder) {
    return { status: "hold", reason: "the folder is not trusted" };
  }
  if (digestOfJson(asJsonValue(params.shown)) !== digestOfJson(asJsonValue(params.planned))) {
    return { status: "hold", reason: "the run differs from what the dialog showed" };
  }
  const refused = params.planned.find(params.refusedByRule);
  return refused
    ? { status: "hold", reason: `a rule refuses ${refused.tool}` }
    : { status: "ok", value: true };
}

export type ScheduleAuthority = Readonly<{
  paused: boolean;
  policy: SandboxToolPolicy;
  project: string;
  maker: string;
  condition?: string;
}>;

/** Saving a pre-run condition: configured aliases only, original permissions kept, schedule paused for review. */
export function saveScheduleCondition(
  schedule: ScheduleAuthority,
  alias: string,
  configuredAliases: ReadonlySet<string>,
): HeldOr<ScheduleAuthority> {
  if (!configuredAliases.has(alias)) {
    return { status: "hold", reason: `${alias} is not a configured command alias` };
  }
  return { status: "ok", value: Object.freeze({ ...schedule, condition: alias, paused: true }) };
}
