// The Branch account, part A of p1-acct: the owner signs in with Google once per device. The refresh token lives
// only in the OS keychain; the state directory keeps who signed in (email and Google's account id) and when.
// Later parts (encrypted backup, device join) start from this signed-in state and stop when it is gone.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { readJsonIfExists, writeJson } from "@openclaw/fs-safe/json";
import { resolveStateDir } from "../config/state-dir.js";
import { startOAuthLoopbackCallbackServer } from "../infra/oauth-loopback-callback.js";
import { renderOAuthPage } from "../shared/oauth-page.js";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  createPkcePair,
  exchangeGoogleAuthCode,
  revokeGoogleToken,
  type FetchLike,
  type GoogleOAuthClient,
  type GoogleOAuthEndpoints,
} from "./google-oauth.js";
import { createOsKeychain, type OsKeychain } from "./os-keychain.js";

export const BRANCH_ACCOUNT_KEYCHAIN_SERVICE = "Branch account";
const CALLBACK_PATH = "/oauth2callback";
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const NOT_CONFIGURED = "Google sign-in isn't set up for this build of Branch yet.";

export type GoogleAccountStatus = {
  /** Sign-in can start here: the build has a Google client and this system has a keychain. */
  available: boolean;
  /** Why it can't, in the owner's words. */
  reason?: string;
  signedIn: boolean;
  email?: string;
  signedInAt?: number;
  /** Where the sign-in is kept, such as "Windows Credential Manager". */
  keychain?: string;
};

type AccountRecord = { provider: "google"; email: string; subject: string; signedInAt: number };

export type BranchAccountDeps = {
  stateDir?: string;
  /** The Google client; null when the build has none. Defaults to the build config. */
  client?: GoogleOAuthClient | null;
  keychain?: OsKeychain;
  fetchImpl?: FetchLike;
  endpoints?: GoogleOAuthEndpoints;
  now?: () => number;
};

/** Build config: release builds bake these in (engine/tsdown.config.ts env); a source checkout reads its environment. */
export function resolveGoogleOAuthClient(): GoogleOAuthClient | undefined {
  const clientId = process.env.BRANCH_GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return undefined;
  }
  const clientSecret = process.env.BRANCH_GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

function recordPath(stateDir: string): string {
  return path.join(stateDir, "account", "google.json");
}

/** One keychain entry per state directory, so a scratch engine never touches the app's own sign-in. */
export function googleKeychainAccount(stateDir: string): string {
  const id = createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 16);
  return `google-refresh-token-${id}`;
}

function resolveDeps(deps: BranchAccountDeps) {
  const stateDir = deps.stateDir ?? resolveStateDir();
  const client =
    deps.client === undefined ? resolveGoogleOAuthClient() : (deps.client ?? undefined);
  let keychain = deps.keychain;
  let keychainError: string | undefined;
  if (!keychain) {
    try {
      keychain = createOsKeychain({ service: BRANCH_ACCOUNT_KEYCHAIN_SERVICE });
    } catch (error) {
      keychainError = error instanceof Error ? error.message : String(error);
    }
  }
  return { stateDir, client, keychain, keychainError };
}

async function readRecord(stateDir: string): Promise<AccountRecord | undefined> {
  const record = await readJsonIfExists<Partial<AccountRecord>>(recordPath(stateDir));
  return record?.provider === "google" &&
    typeof record.email === "string" &&
    typeof record.subject === "string" &&
    typeof record.signedInAt === "number"
    ? (record as AccountRecord)
    : undefined;
}

export async function readGoogleAccountStatus(
  deps: BranchAccountDeps = {},
): Promise<GoogleAccountStatus> {
  const { stateDir, client, keychain, keychainError } = resolveDeps(deps);
  const record = await readRecord(stateDir);
  const reason = !client ? NOT_CONFIGURED : keychainError;
  return {
    available: Boolean(client && keychain),
    ...(reason ? { reason } : {}),
    signedIn: Boolean(record),
    ...(record ? { email: record.email, signedInAt: record.signedInAt } : {}),
    ...(keychain ? { keychain: keychain.label } : {}),
  };
}

async function freeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free loopback port."))));
    });
  });
}

/** Signs in through the system browser: a one-time loopback listener on this computer receives Google's answer,
 *  PKCE ties that answer to this attempt, and the refresh token goes straight into the keychain. */
export async function signInWithGoogle(
  params: BranchAccountDeps & {
    /** Opens the sign-in page in the owner's own browser (never an embedded view). */
    openUrl: (url: string) => Promise<void>;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Runs once Google has answered, before anything is saved (so a cancel can't land half-way). */
    beforeSave?: () => void;
  },
): Promise<GoogleAccountStatus> {
  const { stateDir, client, keychain, keychainError } = resolveDeps(params);
  if (!client) {
    throw new Error(NOT_CONFIGURED);
  }
  if (!keychain) {
    throw new Error(keychainError ?? "This system has no keychain for the sign-in.");
  }
  const { verifier, challenge } = createPkcePair();
  const state = createOAuthState();
  const redirectUri = `http://127.0.0.1:${await freeLoopbackPort()}${CALLBACK_PATH}`;
  const callback = await startOAuthLoopbackCallbackServer({
    redirectUrl: redirectUri,
    expectedState: state,
    timeoutMs: params.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
    ...(params.signal ? { signal: params.signal } : {}),
    renderSuccess: () => ({
      body: renderOAuthPage({
        title: "Signed in to Branch",
        heading: "Signed in to Branch",
        message: "You can close this tab and return to Branch.",
      }),
      contentType: "text/html; charset=utf-8",
    }),
  });
  let result: Awaited<ReturnType<typeof callback.waitForCallback>>;
  try {
    await params.openUrl(
      buildGoogleAuthUrl({
        client,
        redirectUri,
        challenge,
        state,
        ...(params.endpoints ? { endpoints: params.endpoints } : {}),
      }),
    );
    result = await callback.waitForCallback();
  } finally {
    await callback.close();
  }
  if (result.type !== "authorization_code") {
    throw new Error("Google sign-in was not completed.");
  }
  const tokens = await exchangeGoogleAuthCode({
    client,
    code: result.code,
    verifier,
    redirectUri,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    ...(params.endpoints ? { endpoints: params.endpoints } : {}),
  });
  params.beforeSave?.();
  await keychain.set(googleKeychainAccount(stateDir), tokens.refreshToken);
  const record: AccountRecord = {
    provider: "google",
    email: tokens.email,
    subject: tokens.subject,
    signedInAt: (params.now ?? Date.now)(),
  };
  await writeJson(recordPath(stateDir), record, { mode: 0o600, dirMode: 0o700 });
  return await readGoogleAccountStatus({ ...params, stateDir, client, keychain });
}

/** Signs out on this device: Google is told the token is retired, the keychain entry is removed, and the account
 *  record goes, so everything that follows the signed-in state stops. */
export async function signOutOfGoogle(deps: BranchAccountDeps = {}): Promise<GoogleAccountStatus> {
  const { stateDir, client, keychain, keychainError } = resolveDeps(deps);
  if (!keychain) {
    throw new Error(keychainError ?? "This system has no keychain for the sign-in.");
  }
  const account = googleKeychainAccount(stateDir);
  const token = await keychain.get(account);
  if (token) {
    await revokeGoogleToken({
      token,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.endpoints ? { endpoints: deps.endpoints } : {}),
    });
  }
  await keychain.delete(account);
  await fs.rm(recordPath(stateDir), { force: true });
  return await readGoogleAccountStatus({ ...deps, stateDir, client: client ?? null, keychain });
}
