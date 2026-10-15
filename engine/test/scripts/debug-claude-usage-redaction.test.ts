// Debug Claude usage redaction tests cover credential masking on the debug script output path.
import { describe, expect, it } from "vitest";
import { testing as claudeUsageTesting } from "../../scripts/debug-claude-usage.ts";
import { previewForDevToolLog } from "../../scripts/lib/dev-tooling-safety.ts";

const SAMPLE_TOKEN = "sk-test-1234567890abcdefghijklmnop"; // pragma: allowlist secret

describe("debug Claude usage credential logging", () => {
  it("redacts a sample token on the script output path", () => {
    const preview = claudeUsageTesting.formatCredentialForLog(SAMPLE_TOKEN);
    const keychainLine = `Claude Code CLI keychain: accessToken=${preview} scopes=user:inference`;
    const profileLine = `Auth profiles: work token=${preview}`;
    const sessionLine = `Claude web: sessionKey=${preview} (source: --session-key)`;

    expect(preview).not.toContain(SAMPLE_TOKEN);
    expect(keychainLine).not.toContain(SAMPLE_TOKEN);
    expect(profileLine).not.toContain(SAMPLE_TOKEN);
    expect(sessionLine).not.toContain(SAMPLE_TOKEN);
    expect(profileLine).toContain("Auth profiles: work token=");
    expect(sessionLine).toContain("(source: --session-key)");
  });

  it("keeps --reveal from printing raw credentials", () => {
    const parsed = claudeUsageTesting.parseArgs(["--reveal", "--session-key", "sk-test-1234"]);
    expect(parsed.reveal).toBe(true);
    expect(parsed.sessionKey).toBe("sk-test-1234");
    expect(claudeUsageTesting.formatCredentialForLog(parsed.sessionKey ?? "")).not.toContain(
      "sk-test-1234",
    );
  });

  it("keeps usage numbers visible while redacting tokens in response previews", () => {
    const preview = previewForDevToolLog(
      JSON.stringify({
        five_hour: { utilization: 12 },
        extra: SAMPLE_TOKEN,
      }),
      200,
    );

    expect(preview).not.toContain(SAMPLE_TOKEN);
    expect(preview).toContain("12");
  });
});
