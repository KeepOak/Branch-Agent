import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBitwardenCommands } from "./cli.js";
import { parseBitwardenConfig } from "./config.js";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function run(
  args: string[],
  options: { config?: Record<string, unknown>; env?: NodeJS.ProcessEnv; sessionFile?: string } = {},
) {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  const program = new Command();
  program.exitOverride();
  registerBitwardenCommands({
    program,
    config: (options.config ?? {}) as never,
    readPluginConfig: () =>
      parseBitwardenConfig({ signIns: { github: { item: "GitHub", sites: ["github.com"] } } }),
    sessionFile: () => options.sessionFile ?? "/nonexistent/credentials/bitwarden/session",
    env: options.env ?? { PATH: "" },
  });
  await program.parseAsync(["bitwarden", ...args], { from: "user" });
  return output;
}

describe("branch bitwarden", () => {
  it("reports readiness without reading the session", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-bw-cli-"));
    dirs.push(dir);
    const sessionFile = path.join(dir, "session");
    fs.writeFileSync(sessionFile, "secret-session", { mode: 0o600 });
    const status = JSON.parse(
      await run(["status", "--json"], {
        sessionFile,
        config: {
          secrets: {
            providers: {
              bitwarden: {
                source: "exec",
                pluginIntegration: { pluginId: "bitwarden", integrationId: "bitwarden" },
              },
            },
          },
        },
      }),
    );
    expect(status).toMatchObject({
      providerAlias: "bitwarden",
      providerReady: true,
      bwPath: null,
      hasSessionFile: true,
      hasSessionEnv: false,
      signIns: 1,
    });
    expect(JSON.stringify(status)).not.toContain("secret-session");
  });

  it("lists sign-ins for a page", async () => {
    expect(await run(["signins", "--url", "https://github.com/login"])).toBe(
      "github: github.com\n",
    );
    expect(await run(["signins", "--url", "https://gitlab.com/"])).toBe(
      "No sign-in may be filled on that page.\n",
    );
  });
});
