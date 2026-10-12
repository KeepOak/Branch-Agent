// Branch-original shared safety piece (atlas SAFETY-0199): work started from outside is capped.
// Plugs into the tool-policy pipeline as one more ordered step (agents/tool-policy-pipeline.ts).
import { timingSafeEqual } from "node:crypto";
import type { SessionPermissionMode } from "../../packages/gateway-protocol/src/schema/sessions-row.js";
import type { ToolPolicyPipelineStep } from "../agents/tool-policy-pipeline.js";

/** Where a conversation or task started. */
export type WorkOrigin =
  | "window"
  | "owner-direct-chat"
  | "chat-app"
  | "group"
  | "paired-sender"
  | "trigger"
  | "schedule"
  | "voice"
  | "usb"
  | "self-starting-procedure"
  | "trusted-folder";

const MODE_RANK: Record<SessionPermissionMode, number> = {
  "read-only": 0,
  guarded: 1,
  workspace: 2,
  full: 3,
};

const lower = (a: SessionPermissionMode, b: SessionPermissionMode): SessionPermissionMode =>
  MODE_RANK[a] <= MODE_RANK[b] ? a : b;

/** The window and the owner's verified direct chat are the owner's own doors; nothing else is. */
export function isOwnerDoor(origin: WorkOrigin): boolean {
  return origin === "window" || origin === "owner-direct-chat";
}

/**
 * R-1703: whatever the default, outside-started work starts at most on Ask first ("guarded"); a household
 * member never starts looser than the owner; Lockdown wins. The owner's own DMs keep the owner's mode.
 */
export function capStartMode(params: {
  origin: WorkOrigin;
  configured: SessionPermissionMode;
  ownerMode: SessionPermissionMode;
  household: boolean;
  lockdownOn: boolean;
}): SessionPermissionMode {
  if (params.lockdownOn) {
    return "read-only";
  }
  let mode = params.household ? lower(params.configured, params.ownerMode) : params.configured;
  if (!isOwnerDoor(params.origin)) {
    mode = lower(mode, "guarded");
  }
  return mode;
}

/**
 * R-1723: the owner's Full access removes prompts for the owner only. Self-starting procedures, a trusted
 * folder, commands from chat apps and USB-started tasks keep asking; no switch turns that off.
 */
export function skipsApprovalPrompts(params: { origin: WorkOrigin; ownerFullAccess: boolean }): boolean {
  return params.ownerFullAccess && isOwnerDoor(params.origin);
}

/** G-1687: what outside-started tasks may use. Reading the web and reporting status; nothing of the owner's. */
export const OUTSIDE_STARTED_SAFE_TOOLS: readonly string[] = ["web_search", "web_fetch", "session_status"];

/** G-1687 and G-1705: the pipeline step for outside-started work, or undefined for the owner's own doors. */
export function outsideStartedToolPolicyStep(origin: WorkOrigin): ToolPolicyPipelineStep | undefined {
  if (isOwnerDoor(origin)) {
    return undefined;
  }
  return {
    // An empty allow list means "no allowlist" to the matcher, so tool-free is an explicit deny-all.
    policy: origin === "voice" ? { deny: ["*"] } : { allow: [...OUTSIDE_STARTED_SAFE_TOOLS] },
    label: `outside-started cap (${origin})`,
    source: { kind: "runtime" },
  };
}

export type VoiceTurnPolicy =
  | { kind: "owner" }
  | { kind: "isolated"; tools: readonly string[]; ownerMemory: false; ownerContext: false; maxTurns: number };

export const VOICE_ISOLATED_MAX_TURNS = 6;

const digits = (value: string | undefined): string => (value ?? "").replace(/[^\d+]/g, "");

function samePin(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * G-1705: a voice or phone caller gets a bounded, tool-free, isolated turn with no owner memory, context or
 * authority. Owner slots need the exact owner number and the PIN.
 */
export function resolveVoiceTurnPolicy(params: {
  callerNumber: string | undefined;
  ownerNumber: string | undefined;
  pin: string | undefined;
  expectedPin: string | undefined;
}): VoiceTurnPolicy {
  const caller = digits(params.callerNumber);
  const owner = digits(params.ownerNumber);
  if (caller.length > 0 && caller === owner && samePin(params.pin, params.expectedPin)) {
    return { kind: "owner" };
  }
  return { kind: "isolated", tools: [], ownerMemory: false, ownerContext: false, maxTurns: VOICE_ISOLATED_MAX_TURNS };
}
