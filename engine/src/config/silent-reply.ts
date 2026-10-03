import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";
import {
  classifySilentReplyConversationType,
  resolveSilentReplyPolicyFromPolicies,
  type SilentReplyConversationType,
  type SilentReplyPolicy,
} from "../shared/silent-reply-policy.js";
import type { BranchConfig } from "./types.branch.js";

/** Resolves the effective silent-reply settings for a routed conversation. */
export function resolveSilentReplySettings(params: {
  cfg?: BranchConfig;
  sessionKey?: string;
  surface?: string;
  conversationType?: SilentReplyConversationType;
}): {
  policy: SilentReplyPolicy;
} {
  const conversationType = classifySilentReplyConversationType({
    sessionKey: params.sessionKey,
    surface: params.surface,
    conversationType: params.conversationType,
  });
  const normalizedSurface = normalizeLowercaseStringOrEmpty(params.surface);
  // Surfaces are stored under normalized ids; keep explicit conversationType untouched.
  const surface = normalizedSurface ? params.cfg?.surfaces?.[normalizedSurface] : undefined;
  return {
    policy: resolveSilentReplyPolicyFromPolicies({
      conversationType,
      defaultPolicy: params.cfg?.agents?.defaults?.silentReply,
      surfacePolicy: surface?.silentReply,
    }),
  };
}
