// Resolves provider auth tokens from plugin-owned auth configuration.
import { normalizeProviderId } from "@branch/model-catalog-core/provider-id";
import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";
import { createHash } from "node:crypto";

const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;
const DEFAULT_TOKEN_PROFILE_NAME = "default";

function normalizeTokenProfileName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_TOKEN_PROFILE_NAME;
  }
  const slug = normalizeLowercaseStringOrEmpty(trimmed)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || DEFAULT_TOKEN_PROFILE_NAME;
}

/** @deprecated Provider-owned setup helper; do not use from third-party plugins. */
export function buildTokenProfileId(params: { provider: string; name: string }): string {
  const provider = normalizeProviderId(params.provider);
  const name = normalizeTokenProfileName(params.name);
  return `${provider}:${name}`;
}

/** @deprecated Anthropic provider-owned setup helper; do not use from third-party plugins. */
export function validateAnthropicSetupToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Required";
  }
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return "Token looks too short; paste the full setup-token";
  }
  return undefined;
}

export type AnthropicTokenIdentity = { profileId: string; email?: string; accountId?: string };

/** Claude's profile endpoint names the account behind a setup token when its scope permits it. */
export async function resolveAnthropicTokenIdentity(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<AnthropicTokenIdentity> {
  let email: string | undefined;
  let accountId: string | undefined;
  try {
    const response = await fetchFn("https://api.anthropic.com/api/oauth/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const value: unknown = await response.json();
      const account = value && typeof value === "object" && "account" in value ? value.account : undefined;
      if (account && typeof account === "object") {
        const rawEmail = "email" in account ? account.email : undefined;
        const rawId = "uuid" in account ? account.uuid : undefined;
        email = typeof rawEmail === "string" && rawEmail.includes("@") ? rawEmail.trim().toLowerCase() : undefined;
        accountId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : undefined;
      }
    }
  } catch {
    // Inference-only setup tokens may lack user:profile; keep sign-in available.
  }
  // A denied identity request has no account UUID to hash. Hashing the opaque
  // token still gives each saved credential a stable slot instead of overwriting another.
  const digest = createHash("sha256").update(accountId ?? token).digest("hex").slice(0, 12);
  return { profileId: `anthropic:${email ?? `id-${digest}`}`, ...(email ? { email } : {}), ...(accountId ? { accountId } : {}) };
}
