// Settings › Branch account, part A: Sign in with Google against a stand-in Google (no real client ID, no real
// token). The browser step is played by a real HTTP request to the one-time loopback redirect.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  googleKeychainAccount,
  readGoogleAccountStatus,
  signInWithGoogle,
  signOutOfGoogle,
} from "./branch-account.js";
import type { FetchLike, GoogleOAuthEndpoints } from "./google-oauth.js";
import type { OsKeychain } from "./os-keychain.js";

const CLIENT = { clientId: "stand-in-client.apps.googleusercontent.com" };
const ENDPOINTS: GoogleOAuthEndpoints = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
};
const REFRESH_TOKEN = "fake-refresh-token-1//stand-in";
const EMAIL = "owner@example.test";

let stateDir: string;

beforeEach(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-account-"));
});
afterEach(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

function memoryKeychain(): OsKeychain & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    label: "Test keychain",
    saved,
    set: async (account, secret) => {
      saved.set(account, secret);
    },
    get: async (account) => saved.get(account),
    delete: async (account) => {
      saved.delete(account);
    },
  };
}

function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

/** Google's token and revoke endpoints, checking what a real one checks for an installed app with PKCE. */
function fakeGoogle(options: { tokenStatus?: number } = {}) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  let challenge = "";
  let redirectUri = "";
  const fetchImpl: FetchLike = async (url, init) => {
    const form = new URLSearchParams(String(init.body));
    calls.push({ url, form });
    if (url === ENDPOINTS.revokeUrl) {
      return new Response("", { status: 200 });
    }
    const verifier = form.get("code_verifier") ?? "";
    const ok =
      options.tokenStatus === undefined &&
      form.get("grant_type") === "authorization_code" &&
      form.get("code") === "one-time-code" &&
      form.get("client_id") === CLIENT.clientId &&
      form.get("redirect_uri") === redirectUri &&
      createHash("sha256").update(verifier).digest("base64url") === challenge;
    if (!ok) {
      return Response.json(
        { error: "invalid_grant", error_description: "secret detail" },
        { status: options.tokenStatus ?? 400 },
      );
    }
    return Response.json({
      access_token: "fake-access-token",
      expires_in: 3599,
      refresh_token: REFRESH_TOKEN,
      scope: "openid https://www.googleapis.com/auth/userinfo.email",
      token_type: "Bearer",
      id_token: fakeIdToken({
        iss: "https://accounts.google.com",
        aud: CLIENT.clientId,
        sub: "1234567890",
        email: EMAIL,
        email_verified: true,
      }),
    });
  };
  /** The owner's browser: reads the sign-in page's address, then follows Google's redirect back to Branch. */
  const browser = (answer: (url: URL) => URLSearchParams) => async (address: string) => {
    const url = new URL(address);
    challenge = url.searchParams.get("code_challenge") ?? "";
    redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const response = await fetch(`${redirectUri}?${answer(url).toString()}`);
    await response.text();
  };
  return { calls, fetchImpl, browser };
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("Branch account: Sign in with Google", () => {
  it("signs in through the system browser with a loopback redirect and PKCE, then shows the account", async () => {
    const keychain = memoryKeychain();
    const google = fakeGoogle();
    const opened: URL[] = [];
    const status = await signInWithGoogle({
      stateDir,
      client: CLIENT,
      keychain,
      fetchImpl: google.fetchImpl,
      endpoints: ENDPOINTS,
      now: () => 1_791_500_000_000,
      openUrl: google.browser((url) => {
        opened.push(url);
        return new URLSearchParams({
          code: "one-time-code",
          state: url.searchParams.get("state") ?? "",
        });
      }),
    });

    const [page] = opened;
    expect(page?.origin + page?.pathname).toBe(ENDPOINTS.authorizeUrl);
    expect(page?.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(page?.searchParams.get("response_type")).toBe("code");
    expect(page?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(page?.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(page?.searchParams.get("scope")).toBe("openid email");
    expect(page?.searchParams.get("access_type")).toBe("offline");
    expect(page?.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/u,
    );
    expect(page?.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    expect(status).toEqual({
      available: true,
      signedIn: true,
      email: EMAIL,
      signedInAt: 1_791_500_000_000,
      keychain: "Test keychain",
    });
    expect(await readGoogleAccountStatus({ stateDir, client: CLIENT, keychain })).toEqual(status);
    expect(keychain.saved.get(googleKeychainAccount(stateDir))).toBe(REFRESH_TOKEN);
    expect(keychain.saved.size).toBe(1);
  });

  it("keeps the refresh token only in the keychain, never in the state directory", async () => {
    const keychain = memoryKeychain();
    const google = fakeGoogle();
    await signInWithGoogle({
      stateDir,
      client: CLIENT,
      keychain,
      fetchImpl: google.fetchImpl,
      endpoints: ENDPOINTS,
      openUrl: google.browser(
        (url) =>
          new URLSearchParams({
            code: "one-time-code",
            state: url.searchParams.get("state") ?? "",
          }),
      ),
    });
    const files = await filesUnder(stateDir);
    expect(files.map((file) => path.relative(stateDir, file))).toEqual([
      path.join("account", "google.json"),
    ]);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      expect(text).not.toContain(REFRESH_TOKEN);
      expect(text).not.toContain("fake-access-token");
    }
  });

  it("signing out revokes and removes the token and forgets the account", async () => {
    const keychain = memoryKeychain();
    const google = fakeGoogle();
    await signInWithGoogle({
      stateDir,
      client: CLIENT,
      keychain,
      fetchImpl: google.fetchImpl,
      endpoints: ENDPOINTS,
      openUrl: google.browser(
        (url) =>
          new URLSearchParams({
            code: "one-time-code",
            state: url.searchParams.get("state") ?? "",
          }),
      ),
    });
    const status = await signOutOfGoogle({
      stateDir,
      client: CLIENT,
      keychain,
      fetchImpl: google.fetchImpl,
      endpoints: ENDPOINTS,
    });
    expect(status).toEqual({ available: true, signedIn: false, keychain: "Test keychain" });
    expect(keychain.saved.size).toBe(0);
    expect(await filesUnder(stateDir)).toEqual([]);
    const revoke = google.calls.find((call) => call.url === ENDPOINTS.revokeUrl);
    expect(revoke?.form.get("token")).toBe(REFRESH_TOKEN);
  });

  it("saves nothing when the owner declines in the browser", async () => {
    const keychain = memoryKeychain();
    const google = fakeGoogle();
    await expect(
      signInWithGoogle({
        stateDir,
        client: CLIENT,
        keychain,
        fetchImpl: google.fetchImpl,
        endpoints: ENDPOINTS,
        openUrl: google.browser(
          (url) =>
            new URLSearchParams({
              error: "access_denied",
              state: url.searchParams.get("state") ?? "",
            }),
        ),
      }),
    ).rejects.toThrow("Google sign-in was not completed.");
    expect(google.calls).toEqual([]);
    expect(keychain.saved.size).toBe(0);
    expect((await readGoogleAccountStatus({ stateDir, client: CLIENT, keychain })).signedIn).toBe(
      false,
    );
  });

  it("ignores a callback with the wrong state and saves nothing when Google refuses the code", async () => {
    const keychain = memoryKeychain();
    const google = fakeGoogle({ tokenStatus: 400 });
    const error = await signInWithGoogle({
      stateDir,
      client: CLIENT,
      keychain,
      fetchImpl: google.fetchImpl,
      endpoints: ENDPOINTS,
      openUrl: async (address) => {
        const url = new URL(address);
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        const forged = await fetch(`${redirect}?code=forged&state=not-the-state`);
        expect(forged.status).toBe(400);
        await forged.text();
        await google.browser(
          (page) =>
            new URLSearchParams({
              code: "one-time-code",
              state: page.searchParams.get("state") ?? "",
            }),
        )(address);
      },
    }).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe("Google sign-in failed (HTTP 400: invalid_grant).");
    expect(google.calls.map((call) => call.form.get("code"))).toEqual(["one-time-code"]);
    expect(keychain.saved.size).toBe(0);
  });

  it("shows the button unavailable, with the reason, while the build has no Google client", async () => {
    const keychain = memoryKeychain();
    expect(await readGoogleAccountStatus({ stateDir, client: null, keychain })).toEqual({
      available: false,
      reason: "Google sign-in isn't set up for this build of Branch yet.",
      signedIn: false,
      keychain: "Test keychain",
    });
    await expect(
      signInWithGoogle({ stateDir, client: null, keychain, openUrl: async () => undefined }),
    ).rejects.toThrow("Google sign-in isn't set up for this build of Branch yet.");
  });
});
