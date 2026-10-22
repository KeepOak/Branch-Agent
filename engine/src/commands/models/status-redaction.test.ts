// Ensures models status output never carries credential prefixes or account emails.
import { describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../../agents/auth-profiles/types.js";
import { resolveProviderAuthOverview } from "./list.auth-overview.js";
import { createRedactingRuntime } from "./status-redaction.js";

const FAKE_EMAIL = "fake.user+test@example-mail.com";
const FAKE_SECRETS = [
  "sk-ant-oat01-Zq9vX2mN8pL4kR7tY1wB3cD5fG6hJ0aS-QwErTyUiOp_AsDfGhJkL1234", // pragma: allowlist secret
  "sk-ant-api03-Mn8Bv7Cx6Zl5Kj4Hg3Fd2Sa1Po0IuYtReWq-9876ZyXwVuTs5678", // pragma: allowlist secret
  "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", // pragma: allowlist secret
  "ya29.a0AfH6SMBxQ-FAKEoauthACCESStoken_9f8e7d6c5b4a3210zz99", // pragma: allowlist secret
];

vi.mock("../../agents/auth-profiles/display.js", () => ({
  resolveAuthProfileDisplayLabel: vi.fn(
    ({ profileId }: { profileId: string }) => `${profileId} (${FAKE_EMAIL})`,
  ),
}));
vi.mock("../../agents/auth-profiles/persisted.js", () => ({
  loadPersistedAuthProfileStore: vi.fn(() => undefined),
}));
vi.mock("../../agents/auth-profiles/paths.js", () => ({
  resolveAuthStorePathForDisplay: vi.fn(() => "/tmp/auth-profiles.json"),
}));
vi.mock("../../agents/auth-profiles/profiles.js", () => ({
  listProfilesForProvider: vi.fn((store: AuthProfileStore, provider: string) =>
    Object.keys(store.profiles).filter((id) => store.profiles[id]?.provider === provider),
  ),
}));
vi.mock("../../agents/auth-profiles/usage.js", () => ({
  resolveProfileUnusableUntilForDisplay: vi.fn(() => undefined),
}));

/** Every substring of a secret longer than 4 characters is forbidden in output. */
function assertNoSecretFragments(output: string) {
  expect(output).not.toContain(FAKE_EMAIL);
  expect(output).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]/);
  for (const secret of FAKE_SECRETS) {
    for (let i = 0; i + 5 <= secret.length; i += 1) {
      const fragment = secret.slice(i, i + 5);
      if (/^[A-Za-z0-9]{5}$/.test(fragment) && !/^[a-z]+$/.test(fragment)) {
        expect(output, `leaked fragment ${fragment}`).not.toContain(fragment);
      }
    }
  }
}

describe("models status redaction", () => {
  it("masks token, api-key and oauth profile labels including email-bearing ids", () => {
    const store = {
      version: 1,
      profiles: {
        [`anthropic:${FAKE_EMAIL}`]: {
          type: "oauth",
          provider: "anthropic",
          access: FAKE_SECRETS[3],
          refresh: FAKE_SECRETS[3],
          expires: Date.now() + 3_600_000,
          email: FAKE_EMAIL,
        },
        "anthropic:setup-token": { type: "token", provider: "anthropic", token: FAKE_SECRETS[0] },
        "anthropic:api": { type: "api_key", provider: "anthropic", key: FAKE_SECRETS[1] },
      },
    } as unknown as AuthProfileStore;
    const overview = resolveProviderAuthOverview({
      provider: "anthropic",
      cfg: {},
      store,
      modelsPath: "/tmp/models.json",
    });
    const lines: string[] = [];
    const runtime = createRedactingRuntime({
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      exit: () => {},
    });
    runtime.log(overview.profiles.labels.join(", "));
    runtime.log(JSON.stringify(overview));
    runtime.error(`Using ${FAKE_SECRETS[2]} for ${FAKE_EMAIL}`);
    const output = lines.join("\n");
    assertNoSecretFragments(output);
    expect(output).toContain("••••1234");
    expect(output).toContain("••••5678");
    expect(output).toContain("OAuth");
  });

  it("redacts JSON output keys and nested values", () => {
    const written: unknown[] = [];
    const runtime = createRedactingRuntime({
      log: () => {},
      error: () => {},
      exit: () => {},
      writeStdout: (v: string) => written.push(v),
      writeJson: (v: unknown) => written.push(v),
    });
    runtime.writeJson({ [`openai:${FAKE_EMAIL}`]: { label: FAKE_EMAIL, key: FAKE_SECRETS[2] } });
    runtime.writeStdout(`token ${FAKE_SECRETS[0]}`);
    assertNoSecretFragments(JSON.stringify(written));
  });
});
