import { anthropicOAuthProvider } from "../llm/utils/oauth/anthropic.js";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./provider-oauth-runtime.js";

/** The actual lazy SDK login boundary; the shared OAuth index already imports Anthropic. */
export function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  return anthropicOAuthProvider.login(callbacks);
}
