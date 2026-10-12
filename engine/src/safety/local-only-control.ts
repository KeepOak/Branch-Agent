// Branch-original shared safety piece (atlas SAFETY-0194, G-1614): which control changes only the local window
// may make, and which callers count as the local window. The decision itself is in config/lockdown-policy.ts.
import { isDeepStrictEqual } from "node:util";
import { parseConfigJson5 } from "../config/io.read-helpers.js";
import type { GatewayCaller } from "./caller-identity.js";

export type LocalOnlyControl =
  | "lockdown-off"
  | "webhook"
  | "trigger"
  | "chat-setup"
  | "sign-in-code"
  | "person"
  | "whole-config";

export const LOCAL_ONLY_CONTROL_MESSAGE = "Only the window on this computer can make this change.";

/** Methods that always create one of the listed things. */
const LOCAL_ONLY_METHODS = new Map<string, LocalOnlyControl>([
  ["cron.add", "trigger"],
  ["web.login.start", "chat-setup"],
  ["web.login.wait", "chat-setup"],
  ["device.pair.setupCode", "sign-in-code"],
  ["users.linkChannelIdentity", "person"],
  ["users.linkEmail", "person"],
  ["users.setRole", "person"],
  ["config.apply", "whole-config"],
  ["config.set", "whole-config"],
]);

/** Config subtrees where a patch that adds an entry creates a webhook, trigger, chat setup or owner account. */
const LOCAL_ONLY_CONFIG_PATHS: ReadonlyArray<readonly [readonly string[], LocalOnlyControl]> = [
  [["hooks"], "webhook"],
  [["cron"], "trigger"],
  [["channels"], "chat-setup"],
  [["commands", "ownerAllowFrom"], "person"],
];

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const isContainer = (value: unknown): boolean => typeof value === "object" && value !== null;

function pick(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => asRecord(node)?.[key], value);
}

/**
 * True when a merge patch creates something: the subtree did not exist, or the patch adds a new block (a channel,
 * an account, a mapping) or a new list item. Changing or adding a plain setting inside an existing block is an
 * edit, not a creation.
 */
export function patchAddsEntries(patch: unknown, current: unknown): boolean {
  if (patch === null || patch === undefined) {
    return false;
  }
  if (current === undefined || current === null) {
    return true;
  }
  if (Array.isArray(patch)) {
    const existing = Array.isArray(current) ? current : [];
    return patch.some((item) => !existing.some((have) => isDeepStrictEqual(have, item)));
  }
  const patchRecord = asRecord(patch);
  const currentRecord = asRecord(current);
  if (!patchRecord || !currentRecord) {
    return false;
  }
  return Object.entries(patchRecord).some(([key, value]) =>
    key in currentRecord ? patchAddsEntries(value, currentRecord[key]) : isContainer(value),
  );
}

function classifyConfigPatch(params: unknown, currentConfig: unknown): LocalOnlyControl | undefined {
  const raw = asRecord(params)?.raw;
  const parsed = typeof raw === "string" ? parseConfigJson5(raw) : undefined;
  const patch = parsed?.ok ? asRecord(parsed.parsed) : undefined;
  if (!patch) {
    return undefined;
  }
  if (asRecord(patch.security)?.lockdown === false) {
    return "lockdown-off";
  }
  for (const [path, control] of LOCAL_ONLY_CONFIG_PATHS) {
    const value = pick(patch, path);
    if (value !== undefined && patchAddsEntries(value, pick(currentConfig, path))) {
      return control;
    }
  }
  return undefined;
}

/** Which local-only control a request makes, or undefined. Switching Lockdown on is never one. */
export function classifyLocalOnlyControl(
  method: string,
  params: unknown,
  currentConfig: unknown,
): LocalOnlyControl | undefined {
  if (method === "config.patch") {
    return classifyConfigPatch(params, currentConfig);
  }
  // G-1680: approving a sender is allowed from a paired door; naming that sender as the owner is not.
  if (method === "channels.pairing.approve") {
    return asRecord(params)?.bootstrapCommandOwner === true ? "person" : undefined;
  }
  return LOCAL_ONLY_METHODS.get(method);
}

/**
 * The local window: callers on this computer that did not sign in with a paired device key, and in-process
 * callers (they carry their own tool policy). Paired doors, phone keys and callers off this computer are not.
 */
export function isLocalWindowCaller(caller: GatewayCaller): boolean {
  return caller.kind === "owner-window" || caller.kind === "local-operator" || caller.kind === "in-process";
}
