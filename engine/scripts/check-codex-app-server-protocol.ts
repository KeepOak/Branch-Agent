import { spawnSync } from "node:child_process";
// Check Codex App Server Protocol script supports Branch Agent repository automation.
import fs from "node:fs/promises";
import path from "node:path";
import {
  codexAppServerSharedDefinitionsSchema,
  compactCodexAppServerProtocolJsonSchemas,
  expandCodexAppServerProtocolJsonSchema,
  generateExperimentalCodexAppServerProtocolSource,
  normalizeCodexAppServerProtocolJsonText as normalizeJsonSchema,
  selectedCodexAppServerJsonSchemas,
} from "./lib/codex-app-server-protocol-source.js";

const generatedRoot = path.resolve(
  process.cwd(),
  "extensions/codex/src/app-server/protocol-generated",
);

const checks: Record<string, string[]> = {
  "ServerRequest.ts": [
    '"item/commandExecution/requestApproval"',
    '"item/fileChange/requestApproval"',
    '"item/permissions/requestApproval"',
    '"item/tool/call"',
  ],
  "v2/ThreadItem.ts": [
    "delivery: AgentMessageDelivery | null",
    'type: "contextCompaction"',
    'type: "dynamicToolCall"',
    'type: "commandExecution"',
    'type: "mcpToolCall"',
  ],
  "v2/DynamicToolSpec.ts": [
    '"function"',
    "& DynamicToolFunctionSpec",
    '"namespace"',
    "& DynamicToolNamespaceSpec",
  ],
  "v2/DynamicToolFunctionSpec.ts": [
    "name: string",
    "description: string",
    "inputSchema: JsonValue",
  ],
  "v2/DynamicToolNamespaceSpec.ts": [
    "name: string",
    "description: string",
    "tools: Array<DynamicToolNamespaceTool>",
  ],
  "v2/CommandExecutionApprovalDecision.ts": [
    '"accept"',
    '"acceptForSession"',
    '"decline"',
    '"cancel"',
  ],
  "v2/Account.ts": ['type: "apiKey"', 'type: "chatgpt"', 'type: "amazonBedrock"'],
  "v2/AppSummary.ts": [
    "description: string | null",
    "installUrl: string | null",
    "category: string | null",
  ],
  "v2/AppsInstalledParams.ts": ["threadId?: string | null", "forceRefresh?: boolean"],
  "v2/AppsInstalledResponse.ts": ["apps: Array<InstalledApp>"],
  "v2/AppsReadParams.ts": [
    "appIds: Array<string>",
    "threadId?: string | null",
    "includeTools?: boolean",
  ],
  "v2/AppsReadResponse.ts": ["apps: Array<ConnectorMetadata>", "missingAppIds: Array<string>"],
  "v2/CommandExecParams.ts": [
    "command: Array<string>",
    "outputBytesCap?: number | null",
    "timeoutMs?: number | null",
    "env?: { [key in string]?: string | null } | null",
  ],
  "v2/CommandExecResponse.ts": ["exitCode: number", "stdout: string", "stderr: string"],
  "v2/ConfigBatchWriteParams.ts": [
    "edits: Array<ConfigEdit>",
    "filePath?: string | null",
    "expectedVersion?: string | null",
    "reloadUserConfig?: boolean",
  ],
  "v2/ConfigEdit.ts": ["keyPath: string", "value: JsonValue", "mergeStrategy: MergeStrategy"],
  "v2/ConfigValueWriteParams.ts": [
    "keyPath: string",
    "value: JsonValue",
    "mergeStrategy: MergeStrategy",
    "filePath?: string | null",
    "expectedVersion?: string | null",
  ],
  "v2/ConfigWriteResponse.ts": [
    "status: WriteStatus",
    "version: string",
    "filePath: AbsolutePathBuf",
    "overriddenMetadata: OverriddenMetadata | null",
  ],
  "v2/ConfigLayerSource.ts": ['type: "packagedDefaults"', "file: AbsolutePathBuf"],
  "v2/ConfigReadParams.ts": ["includeLayers?: boolean", "cwd?: string | null"],
  "v2/InstalledApp.ts": ["runtimeName: string | null", "enabled: boolean", "callable: boolean"],
  "v2/MarketplaceLoadErrorInfo.ts": ["marketplacePath: AbsolutePathBuf", "message: string"],
  "v2/MergeStrategy.ts": ['"replace"', '"upsert"'],
  "v2/OverriddenMetadata.ts": [
    "message: string",
    "overridingLayer: ConfigLayerMetadata",
    "effectiveValue: JsonValue",
  ],
  "v2/PluginSummary.ts": ["remotePluginId: string | null"],
  "v2/PluginListParams.ts": ["forceRefetch?: boolean"],
  "v2/PluginInstalledParams.ts": [
    "cwds?: Array<AbsolutePathBuf> | null",
    "installSuggestionPluginNames?: Array<string> | null",
  ],
  "v2/PluginInstalledResponse.ts": [
    "marketplaces: Array<PluginMarketplaceEntry>",
    "marketplaceLoadErrors: Array<MarketplaceLoadErrorInfo>",
  ],
  "v2/PluginListResponse.ts": [
    "marketplaces: Array<PluginMarketplaceEntry>",
    "marketplaceLoadErrors: Array<MarketplaceLoadErrorInfo>",
    "featuredPluginIds: Array<string>",
  ],
  "v2/PluginReadParams.ts": ["pluginName: string"],
  "v2/PluginReadResponse.ts": ["plugin: PluginDetail"],
  "v2/PluginInstallParams.ts": ["pluginName: string"],
  "v2/PluginInstallResponse.ts": ["appsNeedingAuth: Array<AppSummary>"],
  "v2/ThreadStartParams.ts": [
    "projectId?: string | null",
    "permissions?: string | null",
    "dynamicTools?: Array<DynamicToolSpec> | null",
    "experimentalRawEvents",
  ],
  "v2/Thread.ts": ["projectId: string | null"],
  "v2/Model.ts": ["multiAgentVersion: MultiAgentVersion | null"],
  "v2/CodexErrorInfo.ts": ['"misalignmentPolicyViolation"'],
  "v2/McpResourceReadParams.ts": [
    "threadId?: string | null",
    "originCallId?: string | null",
    "connectorId?: string | null",
  ],
  "v2/McpResourceReadResponse.ts": ["originCallId: string | null"],
  "v2/StrictReviewRequiredNotification.ts": [
    "threadId: string",
    "turnId: string",
    "startedAtMs: number",
  ],
  "v2/AgentMessageDelivery.ts": ['"async"'],
  "v2/TurnStartParams.ts": ["permissions?: string | null", "serviceTier?: string | null"],
  "v2/WriteStatus.ts": ['"ok"', '"okOverridden"'],
  "ReviewDecision.ts": [
    '"approved"',
    '"approved_for_session"',
    "denied: { rejection: string }",
    '"abort"',
  ],
  "v2/PlanDeltaNotification.ts": ["itemId: string", "delta: string"],
  "v2/TurnPlanUpdatedNotification.ts": ["explanation: string | null", "plan: Array<TurnPlanStep>"],
};

const failures: string[] = [];
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const source = await generateExperimentalCodexAppServerProtocolSource();

  try {
    await compareGeneratedProtocolMirror(source.jsonRoot);
    await checkMaintainedProtocolTypes(source.typescriptRoot);

    for (const [file, snippets] of Object.entries(checks)) {
      const filePath = path.join(source.typescriptRoot, file);
      let text: string;
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch (error) {
        failures.push(`${file}: missing (${String(error)})`);
        continue;
      }
      for (const snippet of snippets) {
        if (!text.includes(snippet)) {
          failures.push(`${file}: missing ${snippet}`);
        }
      }
    }
  } finally {
    await source.cleanup();
  }

  if (failures.length > 0) {
    console.error("Codex app-server generated protocol drift:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(
      `Run \`pnpm codex-app-server:protocol:sync\` after refreshing the Codex checkout at ${source.codexRepo}.`,
    );
    process.exit(1);
  }

  console.log(
    `Codex app-server generated protocol matches Branch Agent bridge assumptions: ${source.codexRepo}`,
  );
}

async function checkMaintainedProtocolTypes(sourceRoot: string): Promise<void> {
  // Raw requests go to Codex; raw responses flow into Branch Agent. Keep the
  // assignability direction explicit so the probe permits deliberate projections.
  const probePath = path.join(sourceRoot, "branch-protocol-compatibility.ts");
  const protocolPath = path.resolve(process.cwd(), "extensions/codex/src/app-server/protocol.ts");
  const protocolImport = relativeTypeScriptImport(probePath, protocolPath);
  const generatedImport = (file: string) =>
    relativeTypeScriptImport(probePath, path.join(sourceRoot, file));
  const probe = `
import type {
  CodexAppServerRequestParams,
  CodexAppServerRequestResult,
  CodexDynamicToolSpec,
  CodexDynamicToolCallParams,
  CodexErrorNotification,
  CodexGetAccountResponse,
  CodexModelListResponse,
  CodexServerNotification,
  CodexThreadForkResponse,
  CodexThreadResumeResponse,
  CodexThreadStartResponse,
  CodexTurnEnvironmentParams,
  v2,
} from ${JSON.stringify(protocolImport)};
import type { AppSummary } from ${JSON.stringify(generatedImport("v2/AppSummary.ts"))};
import type { AppsInstalledParams } from ${JSON.stringify(generatedImport("v2/AppsInstalledParams.ts"))};
import type { AppsInstalledResponse } from ${JSON.stringify(generatedImport("v2/AppsInstalledResponse.ts"))};
import type { AppsListParams } from ${JSON.stringify(generatedImport("v2/AppsListParams.ts"))};
import type { AppsListResponse } from ${JSON.stringify(generatedImport("v2/AppsListResponse.ts"))};
import type { AppsReadParams } from ${JSON.stringify(generatedImport("v2/AppsReadParams.ts"))};
import type { AppsReadResponse } from ${JSON.stringify(generatedImport("v2/AppsReadResponse.ts"))};
import type { CommandExecParams } from ${JSON.stringify(generatedImport("v2/CommandExecParams.ts"))};
import type { CommandExecResponse } from ${JSON.stringify(generatedImport("v2/CommandExecResponse.ts"))};
import type { ConfigBatchWriteParams } from ${JSON.stringify(generatedImport("v2/ConfigBatchWriteParams.ts"))};
import type { ConfigEdit } from ${JSON.stringify(generatedImport("v2/ConfigEdit.ts"))};
import type { ConfigValueWriteParams } from ${JSON.stringify(generatedImport("v2/ConfigValueWriteParams.ts"))};
import type { ConfigWriteResponse } from ${JSON.stringify(generatedImport("v2/ConfigWriteResponse.ts"))};
import type { DynamicToolCallParams } from ${JSON.stringify(generatedImport("v2/DynamicToolCallParams.ts"))};
import type { DynamicToolSpec } from ${JSON.stringify(generatedImport("v2/DynamicToolSpec.ts"))};
import type { ErrorNotification } from ${JSON.stringify(generatedImport("v2/ErrorNotification.ts"))};
import type { ConfigReadParams } from ${JSON.stringify(generatedImport("v2/ConfigReadParams.ts"))};
import type { GetAccountResponse } from ${JSON.stringify(generatedImport("v2/GetAccountResponse.ts"))};
import type { MarketplaceLoadErrorInfo } from ${JSON.stringify(generatedImport("v2/MarketplaceLoadErrorInfo.ts"))};
import type { McpResourceReadParams } from ${JSON.stringify(generatedImport("v2/McpResourceReadParams.ts"))};
import type { McpResourceReadResponse } from ${JSON.stringify(generatedImport("v2/McpResourceReadResponse.ts"))};
import type { ModelListResponse } from ${JSON.stringify(generatedImport("v2/ModelListResponse.ts"))};
import type { PluginInstalledParams } from ${JSON.stringify(generatedImport("v2/PluginInstalledParams.ts"))};
import type { PluginInstalledResponse } from ${JSON.stringify(generatedImport("v2/PluginInstalledResponse.ts"))};
import type { PluginInstallParams } from ${JSON.stringify(generatedImport("v2/PluginInstallParams.ts"))};
import type { PluginInstallResponse } from ${JSON.stringify(generatedImport("v2/PluginInstallResponse.ts"))};
import type { PluginListParams } from ${JSON.stringify(generatedImport("v2/PluginListParams.ts"))};
import type { PluginListResponse } from ${JSON.stringify(generatedImport("v2/PluginListResponse.ts"))};
import type { PluginReadParams } from ${JSON.stringify(generatedImport("v2/PluginReadParams.ts"))};
import type { PluginReadResponse } from ${JSON.stringify(generatedImport("v2/PluginReadResponse.ts"))};
import type { ThreadDeleteParams } from ${JSON.stringify(generatedImport("v2/ThreadDeleteParams.ts"))};
import type { ThreadDeleteResponse } from ${JSON.stringify(generatedImport("v2/ThreadDeleteResponse.ts"))};
import type { ThreadForkParams } from ${JSON.stringify(generatedImport("v2/ThreadForkParams.ts"))};
import type { ThreadForkResponse } from ${JSON.stringify(generatedImport("v2/ThreadForkResponse.ts"))};
import type { ThreadResumeParams } from ${JSON.stringify(generatedImport("v2/ThreadResumeParams.ts"))};
import type { ThreadResumeResponse } from ${JSON.stringify(generatedImport("v2/ThreadResumeResponse.ts"))};
import type { ThreadStartParams } from ${JSON.stringify(generatedImport("v2/ThreadStartParams.ts"))};
import type { ThreadStartResponse } from ${JSON.stringify(generatedImport("v2/ThreadStartResponse.ts"))};
import type { StrictReviewRequiredNotification } from ${JSON.stringify(generatedImport("v2/StrictReviewRequiredNotification.ts"))};
import type { TurnEnvironmentParams } from ${JSON.stringify(generatedImport("v2/TurnEnvironmentParams.ts"))};
import type { TurnInterruptParams } from ${JSON.stringify(generatedImport("v2/TurnInterruptParams.ts"))};
import type { TurnStartParams } from ${JSON.stringify(generatedImport("v2/TurnStartParams.ts"))};
import type { TurnSteerParams } from ${JSON.stringify(generatedImport("v2/TurnSteerParams.ts"))};
import type { TurnSteerResponse } from ${JSON.stringify(generatedImport("v2/TurnSteerResponse.ts"))};

declare const branchAppsInstalledParams: CodexAppServerRequestParams<"app/installed">;
const generatedAppsInstalledParams: AppsInstalledParams = branchAppsInstalledParams;
declare const branchAppsListParams: CodexAppServerRequestParams<"app/list">;
const generatedAppsListParams: AppsListParams = branchAppsListParams;
declare const branchAppsReadParams: CodexAppServerRequestParams<"app/read">;
const generatedAppsReadParams: AppsReadParams = branchAppsReadParams;
declare const branchAppSummary: v2.AppSummary;
const generatedAppSummary: AppSummary = branchAppSummary;
declare const branchCommandExecParams: CodexAppServerRequestParams<"command/exec">;
const generatedCommandExecParams: CommandExecParams = branchCommandExecParams;
declare const generatedNullableCommandExecParams: CommandExecParams;
const branchNullableCommandExecParams: CodexAppServerRequestParams<"command/exec"> =
  generatedNullableCommandExecParams;
declare const branchConfigBatchWriteParams: CodexAppServerRequestParams<"config/batchWrite">;
const generatedConfigBatchWriteParams: ConfigBatchWriteParams = branchConfigBatchWriteParams;
declare const branchConfigEdit: CodexAppServerRequestParams<"config/batchWrite">["edits"][number];
const generatedConfigEdit: ConfigEdit = branchConfigEdit;
declare const branchConfigValueWriteParams: CodexAppServerRequestParams<"config/value/write">;
const generatedConfigValueWriteParams: ConfigValueWriteParams = branchConfigValueWriteParams;
declare const branchPluginInstalledParams: CodexAppServerRequestParams<"plugin/installed">;
const generatedPluginInstalledParams: PluginInstalledParams = branchPluginInstalledParams;
declare const branchPluginInstallParams: CodexAppServerRequestParams<"plugin/install">;
const generatedPluginInstallParams: PluginInstallParams = branchPluginInstallParams;
declare const branchPluginListParams: CodexAppServerRequestParams<"plugin/list">;
const generatedPluginListParams: PluginListParams = branchPluginListParams;
declare const branchPluginReadParams: CodexAppServerRequestParams<"plugin/read">;
const generatedPluginReadParams: PluginReadParams = branchPluginReadParams;
declare const branchDynamicToolSpec: CodexDynamicToolSpec;
const generatedDynamicToolSpec: DynamicToolSpec = branchDynamicToolSpec;
declare const branchTurnEnvironmentParams: CodexTurnEnvironmentParams;
const generatedTurnEnvironmentParams: TurnEnvironmentParams = branchTurnEnvironmentParams;
declare const branchThreadStartParams: CodexAppServerRequestParams<"thread/start">;
const generatedThreadStartParams: ThreadStartParams = branchThreadStartParams;
declare const branchThreadResumeParams: CodexAppServerRequestParams<"thread/resume">;
const generatedThreadResumeParams: ThreadResumeParams = branchThreadResumeParams;
declare const branchThreadForkParams: CodexAppServerRequestParams<"thread/fork">;
const generatedThreadForkParams: ThreadForkParams = branchThreadForkParams;
declare const branchThreadDeleteParams: CodexAppServerRequestParams<"thread/delete">;
const generatedThreadDeleteParams: ThreadDeleteParams = branchThreadDeleteParams;
declare const branchTurnInterruptParams: CodexAppServerRequestParams<"turn/interrupt">;
const generatedTurnInterruptParams: TurnInterruptParams = branchTurnInterruptParams;
declare const branchTurnStartParams: CodexAppServerRequestParams<"turn/start">;
const generatedTurnStartParams: TurnStartParams = branchTurnStartParams;
declare const branchTurnSteerParams: CodexAppServerRequestParams<"turn/steer">;
const generatedTurnSteerParams: TurnSteerParams = branchTurnSteerParams;
// Method-map omissions must not silently weaken required wire fields to unknown.
// @ts-expect-error Thread resume requires its target thread.
const threadResumeWithoutThread: CodexAppServerRequestParams<"thread/resume"> = {};
// @ts-expect-error Starting a turn requires its input.
const turnStartWithoutInput: CodexAppServerRequestParams<"turn/start"> = { threadId: "thread" };
// @ts-expect-error Steering requires the active-turn precondition.
const turnSteerWithoutExpectedTurn: CodexAppServerRequestParams<"turn/steer"> = { threadId: "thread", input: [] };
declare const branchMcpResourceReadParams: CodexAppServerRequestParams<"mcpServer/resource/read">;
const generatedMcpResourceReadParams: McpResourceReadParams = branchMcpResourceReadParams;
declare const branchConfigReadParams: CodexAppServerRequestParams<"config/read">;
const generatedConfigReadParams: ConfigReadParams = branchConfigReadParams;

declare const generatedAppsInstalledResponse: AppsInstalledResponse;
const branchAppsInstalledResponse: CodexAppServerRequestResult<"app/installed"> =
  generatedAppsInstalledResponse;
declare const generatedAppsListResponse: AppsListResponse;
const branchAppsListResponse: CodexAppServerRequestResult<"app/list"> =
  generatedAppsListResponse;
declare const generatedAppsReadResponse: AppsReadResponse;
const branchAppsReadResponse: CodexAppServerRequestResult<"app/read"> =
  generatedAppsReadResponse;
declare const generatedAppSummaryResponse: AppSummary;
const branchAppSummaryResponse: v2.AppSummary = generatedAppSummaryResponse;
declare const generatedCommandExecResponse: CommandExecResponse;
const branchCommandExecResponse: CodexAppServerRequestResult<"command/exec"> =
  generatedCommandExecResponse;
declare const generatedConfigWriteResponse: ConfigWriteResponse;
const branchConfigBatchWriteResponse: CodexAppServerRequestResult<"config/batchWrite"> =
  generatedConfigWriteResponse;
const branchConfigValueWriteResponse: CodexAppServerRequestResult<"config/value/write"> =
  generatedConfigWriteResponse;
const generatedExactConfigBatchWriteResponse: ConfigWriteResponse =
  branchConfigBatchWriteResponse;
const generatedExactConfigValueWriteResponse: ConfigWriteResponse =
  branchConfigValueWriteResponse;
declare const generatedPluginInstalledResponse: PluginInstalledResponse;
const branchPluginInstalledResponse: CodexAppServerRequestResult<"plugin/installed"> =
  generatedPluginInstalledResponse;
const generatedPluginInstalledMarketplaceLoadErrors: MarketplaceLoadErrorInfo[] =
  branchPluginInstalledResponse.marketplaceLoadErrors;
type InstalledPluginResponseHasNoFeaturedCatalog =
  "featuredPluginIds" extends keyof v2.PluginInstalledResponse ? never : true;
const installedPluginResponseHasNoFeaturedCatalog: InstalledPluginResponseHasNoFeaturedCatalog =
  true;
declare const generatedPluginInstallResponse: PluginInstallResponse;
const branchPluginInstallResponse: CodexAppServerRequestResult<"plugin/install"> =
  generatedPluginInstallResponse;
declare const generatedPluginListResponse: PluginListResponse;
const branchPluginListResponse: CodexAppServerRequestResult<"plugin/list"> =
  generatedPluginListResponse;
const generatedPluginListMarketplaceLoadErrors: MarketplaceLoadErrorInfo[] =
  branchPluginListResponse.marketplaceLoadErrors;
const generatedPluginListFeaturedPluginIds: string[] = branchPluginListResponse.featuredPluginIds;
declare const generatedPluginReadResponse: PluginReadResponse;
const branchPluginReadResponse: CodexAppServerRequestResult<"plugin/read"> =
  generatedPluginReadResponse;
declare const generatedDynamicToolCallParams: Omit<DynamicToolCallParams, "arguments">;
const branchDynamicToolCallParams: Omit<CodexDynamicToolCallParams, "arguments"> =
  generatedDynamicToolCallParams;
declare const generatedErrorNotification: ErrorNotification;
const branchErrorNotification: CodexErrorNotification = generatedErrorNotification;
declare const generatedGetAccountResponse: GetAccountResponse;
const branchGetAccountResponse: CodexGetAccountResponse = generatedGetAccountResponse;
declare const generatedModelListResponse: ModelListResponse;
const branchModelListResponse: CodexModelListResponse = generatedModelListResponse;
declare const generatedMcpResourceReadResponse: McpResourceReadResponse;
const branchMcpResourceReadResponse: CodexAppServerRequestResult<"mcpServer/resource/read"> =
  generatedMcpResourceReadResponse;
declare const generatedStrictReviewRequiredNotification: StrictReviewRequiredNotification;
type BranchStrictReviewRequiredNotification = Extract<
  CodexServerNotification,
  { method: "autoApprovalReview/strictReviewRequired" }
>;
const branchStrictReviewRequiredNotification: BranchStrictReviewRequiredNotification = {
  method: "autoApprovalReview/strictReviewRequired",
  params: generatedStrictReviewRequiredNotification,
};
declare const generatedThreadDeleteResponse: ThreadDeleteResponse;
const branchThreadDeleteResponse: CodexAppServerRequestResult<"thread/delete"> =
  generatedThreadDeleteResponse;
declare const generatedTurnSteerResponse: TurnSteerResponse;
const branchTurnSteerResponse: CodexAppServerRequestResult<"turn/steer"> =
  generatedTurnSteerResponse;
const generatedExactTurnSteerResponse: TurnSteerResponse = branchTurnSteerResponse;

// Thread and turn bodies are normalized behind checked-in JSON schemas. Their
// raw generated shapes must not be confused with the projector-facing types.
declare const generatedThreadForkResponse: Omit<ThreadForkResponse, "thread">;
const branchThreadForkResponse: Omit<CodexThreadForkResponse, "thread"> =
  generatedThreadForkResponse;
declare const generatedThreadResumeResponse: Omit<ThreadResumeResponse, "thread">;
const branchThreadResumeResponse: Omit<CodexThreadResumeResponse, "thread"> =
  generatedThreadResumeResponse;
declare const generatedThreadStartResponse: Omit<ThreadStartResponse, "thread">;
const branchThreadStartResponse: Omit<CodexThreadStartResponse, "thread"> =
  generatedThreadStartResponse;

export {};
`;
  await fs.writeFile(probePath, probe);
  const probeConfigPath = path.join(sourceRoot, "branch-protocol-compatibility.tsconfig.json");
  await fs.writeFile(
    probeConfigPath,
    JSON.stringify({
      extends: path.resolve("tsconfig.json"),
      compilerOptions: { rootDir: process.cwd() },
      files: [probePath],
      include: [],
    }),
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/run-tsgo.mjs", "--project", probeConfigPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.error) {
    failures.push(`maintained protocol types: failed to start tsgo (${result.error.message})`);
    return;
  }
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    failures.push(`maintained protocol types differ from generated Codex types\n${output}`);
  }
}

function relativeTypeScriptImport(fromFile: string, toFile: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

async function compareGeneratedProtocolMirror(sourceJsonRoot: string): Promise<void> {
  const sourceSchemas = new Map<string, unknown>();
  for (const schema of selectedCodexAppServerJsonSchemas) {
    const sourcePath = path.join(sourceJsonRoot, schema);
    try {
      sourceSchemas.set(schema, JSON.parse(await fs.readFile(sourcePath, "utf8")));
    } catch (error) {
      failures.push(
        `protocol-generated/json/${schema}: missing upstream schema (${String(error)})`,
      );
    }
  }
  if (sourceSchemas.size !== selectedCodexAppServerJsonSchemas.length) {
    return;
  }

  const expected = compactCodexAppServerProtocolJsonSchemas(sourceSchemas);
  const local = new Map<string, unknown>();
  for (const [schema, expectedValue] of expected) {
    const targetPath = path.join(generatedRoot, "json", schema);
    try {
      const target = await fs.readFile(targetPath, "utf8");
      local.set(schema, JSON.parse(target));
      if (normalizeJsonSchema(JSON.stringify(expectedValue)) !== normalizeJsonSchema(target)) {
        failures.push(`protocol-generated/json/${schema}: differs from compacted source schema`);
      }
    } catch (error) {
      failures.push(`protocol-generated/json/${schema}: missing local schema (${String(error)})`);
    }
  }

  const sharedSchema = local.get(codexAppServerSharedDefinitionsSchema);
  if (sharedSchema === undefined) {
    return;
  }
  for (const schema of selectedCodexAppServerJsonSchemas) {
    const compactSchema = local.get(schema);
    const sourceSchema = sourceSchemas.get(schema);
    if (compactSchema === undefined || sourceSchema === undefined) {
      continue;
    }
    try {
      const expanded = expandCodexAppServerProtocolJsonSchema({
        schema: compactSchema,
        schemaPath: schema,
        sharedSchema,
      });
      if (
        normalizeJsonSchema(JSON.stringify(expanded)) !==
        normalizeJsonSchema(JSON.stringify(sourceSchema))
      ) {
        failures.push(
          `protocol-generated/json/${schema}: compact schema does not expand to its source schema`,
        );
      }
    } catch (error) {
      failures.push(`protocol-generated/json/${schema}: cannot expand (${String(error)})`);
    }
  }
}
