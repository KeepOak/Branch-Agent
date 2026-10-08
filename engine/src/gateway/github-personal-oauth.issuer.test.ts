import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readUserGitHubConnection,
  updateUserGitHubConnection,
} from "../state/user-github-connections.js";
import { ensureProfileForEmail } from "../state/user-profiles.js";
import { createBranchTestState, type BranchTestState } from "../test-utils/branch-test-state.js";
import { ACCOUNT, NEW_PROFILE, TOKENS } from "./github-oauth-lifecycle.test-support.js";
import { createPersonalGitHubOAuthLifecycle } from "./github-personal-oauth.js";

const network = vi.hoisted(() => ({ start: vi.fn(), poll: vi.fn(), refresh: vi.fn() }));
vi.mock("../agents/github-oauth-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/github-oauth-client.js")>()),
  requestGitHubOAuthDeviceCode: network.start,
  pollGitHubOAuthDeviceToken: network.poll,
  refreshGitHubOAuthToken: network.refresh,
}));
vi.mock("./github-cli-preflight.js", () => ({ assertGitHubCliAvailable: vi.fn() }));
vi.mock("../agents/github-tool-identity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/github-tool-identity.js")>()),
  createManagedGitHubProfileId: () => NEW_PROFILE,
  installManagedGitHubProfile: async (params: {
    commitConfig: (account: typeof ACCOUNT) => Promise<void>;
  }) => {
    await params.commitConfig(ACCOUNT);
    return ACCOUNT;
  },
  refreshManagedGitHubProfile: async () => ACCOUNT,
  removeManagedGitHubProfile: async () => {},
}));

let state: BranchTestState;
let lifecycle: ReturnType<typeof createPersonalGitHubOAuthLifecycle>;
let action: { owner: string; assertCurrent: () => void };

beforeEach(async () => {
  state = await createBranchTestState({ scenario: "minimal", applyEnv: true });
  action = { owner: ensureProfileForEmail("issuer@example.test").id, assertCurrent: () => {} };
  network.start.mockReset().mockResolvedValue({
    deviceCode: "d".repeat(40),
    userCode: "ABCD-EFGH",
    verificationUri: "https://github.com/login/device",
    expiresInSeconds: 900,
    intervalSeconds: 5,
  });
  network.poll.mockReset().mockResolvedValue({ status: "authorized", tokens: TOKENS });
  network.refresh.mockReset().mockResolvedValue({
    status: "refreshed",
    tokens: { ...TOKENS, refreshToken: "rotated-refresh" },
  });
  lifecycle = createPersonalGitHubOAuthLifecycle();
});

afterEach(async () => {
  await lifecycle.stop();
  await state.cleanup();
});

async function connect(legacy = false) {
  const started = await lifecycle.startAuthorization(action);
  updateUserGitHubConnection(
    action.owner,
    (current) => {
      if (current?.pending?.kind !== "device") {
        throw new Error("Expected device record");
      }
      const { clientId, ...pending } = current.pending;
      return {
        ...current,
        pending: {
          ...pending,
          ...(!legacy && clientId !== undefined ? { clientId } : {}),
          nextPollAtMs: Date.now(),
        },
      };
    },
    action.assertCurrent,
  );
  expect(await lifecycle.pollAuthorization(action, started.requestId)).toMatchObject({
    status: "success",
  });
}

describe("personal GitHub OAuth issuing app", () => {
  it.each([false, true])("persists and polls the issuing app for legacy=%s", async (legacy) => {
    await connect(legacy);
    expect(network.start).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "Ov23liXOoyCXFFT08XYC" }),
    );
    expect(network.poll).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: legacy ? "Ov23liUjOXHi28w2fDlH" : "Ov23liXOoyCXFFT08XYC",
      }),
    );
    const selection = readUserGitHubConnection(action.owner)?.selection;
    if (legacy) {
      expect(selection).not.toHaveProperty("clientId");
    } else {
      expect(selection).toMatchObject({ clientId: "Ov23liXOoyCXFFT08XYC" });
    }
  });

  it.each([false, true])(
    "refreshes and preserves the issuing app for legacy=%s",
    async (legacy) => {
      await connect(legacy);
      updateUserGitHubConnection(
        action.owner,
        (current) => {
          if (current?.selection.kind !== "connected") {
            throw new Error("Expected connection");
          }
          return {
            ...current,
            selection: { ...current.selection, accessExpiresAtMs: Date.now() - 1 },
          };
        },
        action.assertCurrent,
      );
      await lifecycle.refresh(action.owner);
      expect(network.refresh).toHaveBeenCalledWith({
        refreshToken: TOKENS.refreshToken,
        clientId: legacy ? "Ov23liUjOXHi28w2fDlH" : "Ov23liXOoyCXFFT08XYC",
      });
      const selection = readUserGitHubConnection(action.owner)?.selection;
      expect(selection).toMatchObject({ refreshToken: "rotated-refresh" });
      if (legacy) {
        expect(selection).not.toHaveProperty("clientId");
      } else {
        expect(selection).toMatchObject({ clientId: "Ov23liXOoyCXFFT08XYC" });
      }
    },
  );
});
