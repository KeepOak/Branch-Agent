/**
 * Decides whether one browser tool call runs on the guest pane of its
 * conversation or on Branch's own browser. Every outcome other than a guest
 * answer is spelled out in the tool result, so the fallback is never silent.
 */
import type { AgentToolResult } from "branch/plugin-sdk/agent-core";
import type { LookupFn } from "branch/plugin-sdk/security-runtime";
import {
  assertBrowserNavigationAllowed,
  assertBrowserNavigationResultAllowed,
  type BrowserNavigationPolicyOptions,
} from "../browser/navigation-guard.js";
import { buildGuestArgs, toGuestOp, type GuestActInput } from "./guest-args.js";
import {
  getBrowserGuestRegistry,
  type GuestOp,
  type GuestOutcome,
  type GuestRegistry,
} from "./guest-registry.js";
import { formatGuestResult, readGuestResultUrl } from "./guest-result.js";

export const GUEST_NOT_OPEN_NOTICE = "Your browser pane isn't open, so I used Branch's own browser.";
export const GUEST_TIMEOUT_NOTICE = "The browser pane didn't answer, so I used Branch's own browser.";

export type GuestRouteDecision =
  | { kind: "playwright"; notice?: string }
  | { kind: "guest"; result: AgentToolResult<unknown> };

export type GuestRouteInput = {
  action: string;
  sessionKey: string;
  eligible: boolean;
  url?: string;
  act?: GuestActInput;
  navigationPolicy: BrowserNavigationPolicyOptions;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
  registry?: GuestRegistry;
};

/** A call can use the guest pane only for a managed host browser of its own conversation. */
export function isGuestEligible(input: {
  sessionKey: string | undefined;
  requestedProfile: string | undefined;
  defaultProfile: string;
  usesUserBrowser: boolean;
  routed: boolean;
  bound: boolean;
  actAllowed: boolean;
}): boolean {
  return (
    Boolean(input.sessionKey) &&
    (input.requestedProfile === undefined || input.requestedProfile === input.defaultProfile) &&
    !input.usesUserBrowser &&
    !input.routed &&
    !input.bound &&
    input.actAllowed
  );
}

/** Add the plain fallback sentence in front of a Playwright result. */
export function withFallbackNotice(
  result: AgentToolResult<unknown>,
  notice: string | undefined,
): AgentToolResult<unknown> {
  if (!notice) {
    return result;
  }
  return { ...result, content: [{ type: "text", text: notice }, ...result.content] };
}

async function assertNavigationAllowed(url: string, input: GuestRouteInput): Promise<void> {
  await assertBrowserNavigationAllowed({
    url,
    lookupFn: input.lookupFn,
    signal: input.signal,
    ...input.navigationPolicy,
  });
}

async function settleOutcome(
  op: GuestOp,
  outcome: GuestOutcome,
  input: GuestRouteInput,
): Promise<GuestRouteDecision> {
  switch (outcome.kind) {
    case "timeout":
      return { kind: "playwright", notice: GUEST_TIMEOUT_NOTICE };
    case "unavailable":
      return { kind: "playwright", notice: GUEST_NOT_OPEN_NOTICE };
    case "aborted":
      input.signal?.throwIfAborted();
      throw new Error("The browser request was cancelled.");
    case "answered":
      break;
  }
  if (!outcome.answer.ok) {
    throw new Error(outcome.answer.error);
  }
  if (op === "navigate") {
    await assertBrowserNavigationResultAllowed({
      url: readGuestResultUrl(outcome.answer.result),
      lookupFn: input.lookupFn,
      signal: input.signal,
      ...input.navigationPolicy,
    });
  }
  return { kind: "guest", result: formatGuestResult(op, outcome.answer.result) };
}

/**
 * Route one browser tool call. Returns a guest result, or tells the caller to
 * run the Playwright path (with the notice to prefix, if any). Refusals and
 * guard blocks throw, and nothing is sent to the pane for them.
 */
export async function routeBrowserActionToGuest(
  input: GuestRouteInput,
): Promise<GuestRouteDecision> {
  const op = input.eligible ? toGuestOp(input.action) : undefined;
  if (!op) {
    return { kind: "playwright" };
  }
  const registry = input.registry ?? getBrowserGuestRegistry();
  const built = buildGuestArgs(op, { url: input.url, act: input.act });
  if (!registry.isReady(input.sessionKey)) {
    // A refused address stays refused whether or not the pane is open.
    if (op === "navigate" && !built.ok) {
      throw new Error(built.error);
    }
    return { kind: "playwright", notice: GUEST_NOT_OPEN_NOTICE };
  }
  if (!built.ok) {
    throw new Error(built.error);
  }
  if (op === "navigate") {
    await assertNavigationAllowed((input.url ?? "").trim(), input);
  }
  const outcome = await registry.request({
    sessionKey: input.sessionKey,
    op,
    args: built.args,
    signal: input.signal,
  });
  return settleOutcome(op, outcome, input);
}
