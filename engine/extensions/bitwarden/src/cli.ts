import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BranchConfig } from "branch/plugin-sdk/plugin-entry";
import { createPluginSecretRefSetupCli } from "branch/plugin-sdk/secret-ref-runtime";
import { resolvePreferredBranchTmpDir } from "branch/plugin-sdk/temp-path";
import { encodeBitwardenSecretId } from "../bitwarden-secret-id.js";
import { DEFAULT_PROVIDER_ALIAS, type BitwardenConfig } from "./config.js";
import { listFillEntries, matchFillEntries } from "./signins.js";

const bitwardenSecretRefSetupCli = createPluginSecretRefSetupCli({
  productName: "Bitwarden",
  secretIdLabel: "Bitwarden item and field",
  secretIdPlaceholder: "item/field",
  defaultProviderAlias: DEFAULT_PROVIDER_ALIAS,
  pluginIntegration: { pluginId: "bitwarden", integrationId: "bitwarden" },
  normalizeSecretId: (label, value) => {
    try {
      return encodeBitwardenSecretId(value);
    } catch (error) {
      throw new Error(
        `Invalid ${label} Bitwarden reference: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  },
  defaultPlanPath: () =>
    path.join(resolvePreferredBranchTmpDir(), `branch-bitwarden-secrets-${process.pid}.json`),
});

type CommandLike = Parameters<typeof bitwardenSecretRefSetupCli.registerSetupCommand>[0];

export type RegisterBitwardenCommandsParams = {
  program: CommandLike;
  config: BranchConfig;
  readPluginConfig: () => BitwardenConfig;
  sessionFile: () => string;
  env?: NodeJS.ProcessEnv;
};

function writeLine(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function isExecutable(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** Where the resolver will find bw: BRANCH_BITWARDEN_BW, else the first bw on PATH. */
export function findBitwardenCli(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.BRANCH_BITWARDEN_BW?.trim();
  if (configured) {
    return path.isAbsolute(configured) && isExecutable(configured) ? configured : undefined;
  }
  const executable = process.platform === "win32" ? "bw.exe" : "bw";
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (directory && path.isAbsolute(directory) && isExecutable(path.join(directory, executable))) {
      return path.join(directory, executable);
    }
  }
  return undefined;
}

function resolverScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../bitwarden-secret-ref-resolver.js", import.meta.url)),
    fileURLToPath(
      new URL("./extensions/bitwarden/bitwarden-secret-ref-resolver.js", import.meta.url),
    ),
  ] as const;
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function registerBitwardenCommands(params: RegisterBitwardenCommandsParams): void {
  const env = params.env ?? process.env;
  const bitwarden = params.program
    .command("bitwarden")
    .description("Manage Bitwarden SecretRefs and sign-ins");
  bitwarden
    .command("status")
    .description("Show Bitwarden readiness without reading a secret")
    .option("--json", "Print JSON status")
    .option("--provider-alias <alias>", "Secret provider alias to inspect")
    .action((options: { json?: boolean; providerAlias?: string }) => {
      const { providerAlias, provider, providerReady } = bitwardenSecretRefSetupCli.inspectProvider(
        params.config,
        options.providerAlias,
      );
      const sessionFile = params.sessionFile();
      const bwPath = findBitwardenCli(env);
      const pluginConfig = params.readPluginConfig();
      const result = {
        providerAlias,
        provider,
        providerReady,
        resolverScript: resolverScriptPath(),
        bwPath: bwPath ?? null,
        sessionFile,
        hasSessionFile: fs.existsSync(sessionFile),
        hasSessionEnv: Boolean(env.BW_SESSION?.trim()),
        signIns: pluginConfig.signIns.length,
      };
      if (options.json) {
        writeLine(JSON.stringify(result, null, 2));
        return;
      }
      writeLine(
        `Bitwarden provider: ${providerReady ? "ready" : provider.configured ? "configured, not the Bitwarden plugin" : "not configured"}`,
      );
      writeLine(`Bitwarden CLI: ${bwPath ?? "not found (install bw or set BRANCH_BITWARDEN_BW)"}`);
      writeLine(`Session file: ${sessionFile} (${result.hasSessionFile ? "present" : "missing"})`);
      writeLine(`BW_SESSION: ${result.hasSessionEnv ? "set" : "not set"}`);
      writeLine(`Sign-ins Branch may fill: ${result.signIns}`);
      if (!result.hasSessionFile && !result.hasSessionEnv) {
        writeLine(`Unlock with: bw unlock --raw > ${JSON.stringify(sessionFile)}`);
      }
    });
  bitwarden
    .command("signins")
    .description("List the sign-ins Branch may fill (references only, never passwords)")
    .option("--url <url>", "Only sign-ins that may be filled on this page")
    .option("--json", "Print JSON")
    .action((options: { url?: string; json?: boolean }) => {
      const config = params.readPluginConfig();
      const entries = options.url ? matchFillEntries(config, options.url) : listFillEntries(config);
      if (options.json) {
        writeLine(
          JSON.stringify({ providerAlias: config.providerAlias, signIns: entries }, null, 2),
        );
        return;
      }
      if (entries.length === 0) {
        writeLine(
          options.url ? "No sign-in may be filled on that page." : "No sign-ins configured.",
        );
        return;
      }
      for (const entry of entries) {
        writeLine(
          `${entry.slug}: ${entry.sites.join(", ")}${entry.refs.totp ? " (with code)" : ""}`,
        );
      }
    });
  bitwardenSecretRefSetupCli.registerSetupCommand(bitwarden);
}
