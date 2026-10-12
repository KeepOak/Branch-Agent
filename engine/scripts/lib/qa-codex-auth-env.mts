import { getRootOptionAwareCommandPath } from "../../cli-root-options.mjs";
import {
  readCodexCliActiveApiKey,
  type CodexCliApiKeyCredential,
} from "../../src/agents/cli-credentials.ts";

export const BRANCH_QA_CODEX_API_KEY_HANDOFF = "BRANCH_QA_CODEX_API_KEY_HANDOFF";

export type ReadQaCodexApiKey = (options?: {
  codexHome?: string;
  allowKeychainPrompt?: boolean;
}) => CodexCliApiKeyCredential | null;

const PORTABLE_QA_OPENAI_AUTH_ENV_KEYS = [
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "BRANCH_LIVE_CODEX_API_KEY",
  "BRANCH_LIVE_OPENAI_KEY",
] as const;

function selectsLiveFrontierQaSuite(args: readonly string[]): boolean {
  const [rootCommand, nestedCommand] = getRootOptionAwareCommandPath(
    ["node", "branch", ...args],
    2,
  );
  if (rootCommand !== "qa" || nestedCommand !== "suite") {
    return false;
  }
  return args.some(
    (arg, index) =>
      arg === "--provider-mode=live-frontier" ||
      (arg === "--provider-mode" && args[index + 1] === "live-frontier"),
  );
}

export function resolveQaCodexApiKeyEnvPatch(params: {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  readCodexApiKey?: ReadQaCodexApiKey;
}): NodeJS.ProcessEnv | undefined {
  if (
    !selectsLiveFrontierQaSuite(params.args) ||
    PORTABLE_QA_OPENAI_AUTH_ENV_KEYS.some((envKey) => params.env[envKey]?.trim())
  ) {
    return undefined;
  }
  const codexHome = params.env.CODEX_HOME?.trim();
  const credential = (params.readCodexApiKey ?? readCodexCliActiveApiKey)({
    ...(codexHome ? { codexHome } : {}),
    allowKeychainPrompt: false,
  });
  return credential ? { [BRANCH_QA_CODEX_API_KEY_HANDOFF]: credential.key } : undefined;
}
