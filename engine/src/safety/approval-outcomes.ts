// provos/ironcurtain@8f9c75a720337271caf1e18c199fcca2d299ad27:src/trusted-process/auto-approver.ts (atlas SAFETY-0216; changed: deterministic exact-call match, no model)
// Two extra rule outcomes beside allow, ask and deny (atlas SAFETY-0216, R-1384): "hand-off" (the Trunk prepares
// the step and gives it to the owner through Take over or Needs you) and "only-if-asked" (runs when the owner's own
// message asked for exactly this call). Idea from provos/ironcurtain@8f9c75a720337271caf1e18c199fcca2d299ad27:
// src/trusted-process/auto-approver.ts — a non-match escalates to the owner, it never denies on its own.
// Deterministic here: exact tool name and canonical-argument digest, no model in the decision.
import { asJsonValue, digestOfJson } from "../infra/signed-receipts/canonical-json.js";

export type RuleOutcome = "allow" | "ask" | "deny" | "hand-off" | "only-if-asked";

export type ToolCallRef = { toolName: string; args: unknown };

/** What the owner's own latest message explicitly asked for, recorded at trusted ingress. */
export type OwnerAsk = Readonly<{ toolName: string; argsDigest: string; fromOwner: boolean }>;

export type OutcomeDecision =
  | { kind: "allow"; via: "rule" | "owner-asked" | "full-access" }
  | { kind: "ask"; why: string }
  | { kind: "deny"; why: string }
  | { kind: "hand-off"; prepared: ToolCallRef; why: string };

/** Optional, owner's choice, not default: steps that stay asked even under Full access. */
export type OwnerFloor = Readonly<{ enabled: boolean; categories: ReadonlySet<string> }>;

export const OWNER_FLOOR_CHOICES: readonly string[] = ["password-change", "move-money"];

export function argsDigest(args: unknown): string {
  return digestOfJson(asJsonValue(args));
}

/** Record an owner request; anything not from the owner never counts. */
export function ownerAskFor(call: ToolCallRef, fromOwner: boolean): OwnerAsk {
  return Object.freeze({ toolName: call.toolName, argsDigest: argsDigest(call.args), fromOwner });
}

function ownerAskedExactly(call: ToolCallRef, asks: readonly OwnerAsk[]): boolean {
  const digest = argsDigest(call.args);
  return asks.some((a) => a.fromOwner && a.toolName === call.toolName && a.argsDigest === digest);
}

function resolveBaseOutcome(
  rule: RuleOutcome,
  call: ToolCallRef,
  asks: readonly OwnerAsk[],
): OutcomeDecision {
  switch (rule) {
    case "allow":
      return { kind: "allow", via: "rule" };
    case "deny":
      return { kind: "deny", why: "a rule refuses this" };
    case "hand-off":
      return { kind: "hand-off", prepared: call, why: "your rule says you do this step yourself" };
    case "only-if-asked":
      return ownerAskedExactly(call, asks)
        ? { kind: "allow", via: "owner-asked" }
        : { kind: "ask", why: "you did not ask for exactly this" };
    default:
      return { kind: "ask", why: "a rule asks first" };
  }
}

/**
 * Resolve a rule outcome for one call. The owner on Full access is asked nothing, except a deny rule stays a deny
 * (the owner's own named rule) and an enabled owner floor keeps its categories asked.
 */
export function resolveRuleOutcome(params: {
  rule: RuleOutcome;
  call: ToolCallRef;
  ownerAsks?: readonly OwnerAsk[];
  ownerFullAccess?: boolean;
  category?: string;
  floor?: OwnerFloor;
}): OutcomeDecision {
  const floorHit =
    params.floor?.enabled === true &&
    params.category !== undefined &&
    params.floor.categories.has(params.category);
  if (floorHit && params.rule !== "deny") {
    return { kind: "ask", why: "your floor keeps this asked even under Full access" };
  }
  const base = resolveBaseOutcome(params.rule, params.call, params.ownerAsks ?? []);
  if (params.ownerFullAccess && base.kind === "ask") {
    return { kind: "allow", via: "full-access" };
  }
  return base;
}
