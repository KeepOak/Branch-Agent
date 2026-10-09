// Google sign-in for the Branch account: the OAuth 2.0 flow for installed apps (system browser, loopback redirect,
// PKCE S256). Adapted from extensions/google-meet/src/oauth.ts. The client ID is public and comes from the build;
// the refresh token it returns is handed straight to the OS keychain by the caller and never logged.
import { createHash, randomBytes } from "node:crypto";
import { readResponseWithLimit } from "../infra/http-body.js";
import { registerSecretValueForRedaction } from "../logging/secret-redaction-registry.js";

export type GoogleOAuthEndpoints = { authorizeUrl: string; tokenUrl: string; revokeUrl: string };
export const GOOGLE_OAUTH_ENDPOINTS: GoogleOAuthEndpoints = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
};
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Who the owner is, and nothing more. The backup (drive.appdata) asks for its own scope when it arrives. */
export const GOOGLE_SIGN_IN_SCOPES = ["openid", "email"] as const;

/** A desktop OAuth client. Google issues desktop clients a "secret" that is not confidential; the build may pass it. */
export type GoogleOAuthClient = { clientId: string; clientSecret?: string };
export type GoogleSignInTokens = { refreshToken: string; email: string; subject: string };
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 64 * 1024;

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildGoogleAuthUrl(params: {
  client: GoogleOAuthClient;
  redirectUri: string;
  challenge: string;
  state: string;
  endpoints?: GoogleOAuthEndpoints;
}): string {
  const search = new URLSearchParams({
    client_id: params.client.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    scope: GOOGLE_SIGN_IN_SCOPES.join(" "),
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state: params.state,
  });
  return `${(params.endpoints ?? GOOGLE_OAUTH_ENDPOINTS).authorizeUrl}?${search.toString()}`;
}

function protocolError(): Error {
  return new Error("Google's sign-in answer was not understood. Try again.");
}

async function postForm(
  fetchImpl: FetchLike,
  url: string,
  form: Record<string, string | undefined>,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value) {
      body.set(key, value);
    }
  }
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bytes = await readResponseWithLimit(response, RESPONSE_MAX_BYTES, {
    chunkTimeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    onOverflow: protocolError,
    onIdleTimeout: protocolError,
    onTimeout: protocolError,
  });
  if (bytes.length === 0) {
    return { response, body: {} };
  }
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    return {
      response,
      body: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    };
  } catch {
    throw protocolError();
  }
}

/** The ID token came straight from Google's token endpoint over TLS, so its claims are read without a signature
 *  check (OpenID Connect Core 3.1.3.7); issuer and audience are still matched. */
function readIdToken(idToken: unknown, clientId: string): { email: string; subject: string } {
  if (typeof idToken !== "string") {
    throw protocolError();
  }
  const payload = idToken.split(".")[1];
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw protocolError();
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    typeof claims.iss !== "string" ||
    !GOOGLE_ISSUERS.has(claims.iss) ||
    !audience.includes(clientId) ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !claims.email.includes("@") ||
    claims.email_verified === false
  ) {
    throw protocolError();
  }
  return { email: claims.email, subject: claims.sub };
}

/** Trades the browser's one-time code (with the PKCE verifier) for a lasting refresh token and who signed in. */
export async function exchangeGoogleAuthCode(params: {
  client: GoogleOAuthClient;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
  endpoints?: GoogleOAuthEndpoints;
}): Promise<GoogleSignInTokens> {
  const { response, body } = await postForm(
    params.fetchImpl ?? fetch,
    (params.endpoints ?? GOOGLE_OAUTH_ENDPOINTS).tokenUrl,
    {
      client_id: params.client.clientId,
      client_secret: params.client.clientSecret,
      code: params.code,
      code_verifier: params.verifier,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
    },
  );
  if (typeof body.access_token === "string") {
    registerSecretValueForRedaction(body.access_token);
  }
  if (typeof body.refresh_token === "string") {
    registerSecretValueForRedaction(body.refresh_token);
  }
  if (!response.ok) {
    // Google's error code (such as invalid_grant) only; never the request or the rest of the body.
    const code =
      typeof body.error === "string" && /^[a-z_]{1,64}$/u.test(body.error) ? `: ${body.error}` : "";
    throw new Error(`Google sign-in failed (HTTP ${response.status}${code}).`);
  }
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
  if (!refreshToken) {
    throw new Error("Google didn't return a lasting sign-in. Try again.");
  }
  return { refreshToken, ...readIdToken(body.id_token, params.client.clientId) };
}

/** Tells Google the refresh token is no longer used. Signing out removes it from this device either way. */
export async function revokeGoogleToken(params: {
  token: string;
  fetchImpl?: FetchLike;
  endpoints?: GoogleOAuthEndpoints;
}): Promise<boolean> {
  try {
    const { response } = await postForm(
      params.fetchImpl ?? fetch,
      (params.endpoints ?? GOOGLE_OAUTH_ENDPOINTS).revokeUrl,
      { token: params.token },
    );
    return response.ok;
  } catch {
    // Offline or refused: the token is still deleted from the keychain by the caller.
    return false;
  }
}
