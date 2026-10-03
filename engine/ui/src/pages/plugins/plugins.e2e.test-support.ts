// Control UI tests cover plugin catalog browsing and lifecycle mutations.
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { describe } from "vitest";
import type { PluginsSearchResult } from "../../../../packages/gateway-protocol/src/schema/plugins.ts";
import { PROTOCOL_VERSION } from "../../../../packages/gateway-protocol/src/version.js";
import type {
  PluginCatalogItem,
  PluginDiscoveryDetailResult,
  PluginListResult,
  PluginMutationResult,
  PluginsInspectResult,
} from "../../lib/plugins/index.ts";
import { createControlUiE2eArtifactDir } from "../../test-helpers/control-ui-e2e-artifacts.ts";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../../test-helpers/control-ui-e2e.ts";
import {
  discoveryCategories,
  discoveryResult,
  finalDiscoveryPageItems,
  localOnlyDiscoveryPlugin,
  matrixDiscoveryPlugin,
  secondDiscoveryPageItems,
} from "../../test-helpers/plugins-e2e-fixtures.test-support.ts";
const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.BRANCH_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;
const updateScreenshots = process.env.BRANCH_UPDATE_E2E_SCREENSHOTS === "1";
const artifacts = new WeakMap<Page, string>();
const mobileViewport = { height: 852, width: 393 };
const desktopViewport = { height: 1000, width: 1440 };
const pluginMethods = [
  "plugins.reload",
  "plugins.uiDescriptors",
  "plugins.controlUi.list",
  "plugins.controlUi.report",
  "plugins.list",
  "plugins.inspect",
  "plugins.search",
  "plugins.catalog.browse",
  "plugins.catalog.categories",
  "plugins.catalog.get",
  "plugins.install",
  "plugins.setEnabled",
  "plugins.uninstall",
];
const canopyDisabled = {
  id: "canopy",
  name: "Canopy",
  packageName: "@branch/canopy",
  description: "Dashboard canopy for agent-owned issues and sessions.",
  version: "2026.7.9",
  kind: ["productivity"],
  origin: "bundled",
  installed: true,
  enabled: false,
  state: "disabled",
  featured: true,
  order: 10,
  category: "tool",
  removable: false,
} satisfies PluginCatalogItem;

const canopyEnabled = {
  ...canopyDisabled,
  enabled: true,
  state: "enabled",
} satisfies PluginCatalogItem;

const trellisPlugin = {
  id: "trellis",
  name: "Trellis",
  description: "Run typed workflows with resumable approvals.",
  kind: ["plugin"],
  origin: "official",
  installed: false,
  enabled: false,
  state: "not-installed",
  featured: true,
  order: 50,
  install: { source: "clawhub", packageName: "@branch/trellis" },
} satisfies PluginCatalogItem;

const remoteIconPlugin = {
  id: "remote-icon",
  name: "FireCrawl",
  description: "Web extraction and crawling.",
  kind: ["plugin"],
  origin: "official",
  installed: false,
  enabled: false,
  state: "not-installed",
  featured: true,
  order: 60,
  hasIcon: true,
  install: { source: "clawhub", packageName: "@branch/firecrawl" },
} satisfies PluginCatalogItem;

const calendarPlugin = {
  id: "calendar-plus",
  name: "Calendar Plus",
  packageName: "calendar-plus",
  description: "Plan and coordinate work from a shared calendar.",
  version: "1.2.3",
  kind: ["productivity"],
  origin: "global",
  installed: true,
  enabled: true,
  state: "enabled",
  category: "tool",
  removable: true,
} satisfies PluginCatalogItem;

const telegramPlugin = {
  id: "telegram",
  name: "Telegram",
  packageName: "@branch/telegram",
  description: "Chat with your agent from Telegram groups and direct messages.",
  version: "1.4.0",
  kind: ["channel"],
  origin: "bundled",
  installed: true,
  enabled: false,
  state: "disabled",
  category: "channel",
  removable: false,
} satisfies PluginCatalogItem;

const initialInventory = inventory([
  canopyDisabled,
  telegramPlugin,
  trellisPlugin,
  remoteIconPlugin,
]);
const calendarSearchResponse = {
  results: [
    {
      score: 0.98,
      package: {
        name: "calendar-plus",
        displayName: "Calendar Plus",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        summary: "Plan and coordinate work from a shared calendar.",
        latestVersion: "1.2.3",
        downloads: 1420,
        verificationTier: "source-linked",
      },
    },
  ],
} satisfies PluginsSearchResult;

const uninstallResult = {
  ok: true,
  pluginId: "calendar-plus",
  restartRequired: false,
  removed: ["config entry", "install record", "directory"],
};

const installResult = {
  ok: true,
  plugin: calendarPlugin,
  restartRequired: false,
} satisfies PluginMutationResult;

const installPolicyWarning = {
  installPolicyCode: "install_policy_warning_acknowledgement_required",
  targetName: "@branch/trellis",
  targetType: "plugin",
  requestMode: "install",
  reason: "GroveScan found issues to review.",
  findings: [
    {
      ruleId: "semgrep-finding",
      severity: "warn",
      message: "Semgrep found a risky command.",
      file: "index.ts",
      line: 12,
    },
  ],
};

const changedInstallPolicyWarning = {
  ...installPolicyWarning,
  reason: "GroveScan returned a changed warning after the fresh check.",
  findings: [
    {
      ruleId: "dependency-finding",
      severity: "critical",
      message: "The freshly checked warning changed and requires review.",
      file: "package-lock.json",
      line: 24,
    },
  ],
};

const enableCanopyResult = {
  ok: true,
  plugin: canopyEnabled,
  restartRequired: false,
} satisfies PluginMutationResult;

const canopyInspection = {
  ok: true,
  reviewToken: "a".repeat(64),
  plugin: {
    id: canopyDisabled.id,
    name: canopyDisabled.name,
    origin: canopyDisabled.origin,
    installed: true,
    enabled: false,
  },
  source: { kind: "npm", packageName: canopyDisabled.packageName },
  declared: {
    channels: [],
    providers: [],
    tools: [],
    contracts: [],
    hooks: [],
    mcpServers: [],
    cliCommands: [],
    cliBackends: [],
    skills: [],
    dangerousConfigFlags: [],
  },
  components: {
    mapped: [],
    skills: [],
    mcpServers: [],
    commands: [],
    hooks: [],
    lspServers: [],
    unavailable: { capabilities: [], mcpServers: [], lspServers: [] },
  },
  grants: {
    hooks: {
      allowPromptInjection: { effective: true },
      allowConversationAccess: { effective: true },
    },
  },
} satisfies PluginsInspectResult;

const trellisInspection = {
  ...canopyInspection,
  reviewToken: "b".repeat(64),
  plugin: {
    id: trellisPlugin.id,
    name: trellisPlugin.name,
    origin: trellisPlugin.origin,
    installed: false,
    enabled: false,
  },
  source: { kind: "npm", packageName: "@branch/trellis" },
} satisfies PluginsInspectResult;

const calendarInspection = {
  ...canopyInspection,
  reviewToken: "c".repeat(64),
  plugin: { ...calendarPlugin, installed: false, enabled: false },
  source: { kind: "clawhub", packageName: "calendar-plus" },
  declared: { ...canopyInspection.declared, tools: ["calendar_create"] },
} satisfies PluginsInspectResult;

const matrixDetail = {
  plugin: {
    ...matrixDiscoveryPlugin,
    catalog: { ...matrixDiscoveryPlugin.catalog, latestVersion: "2.1.0" },
  },
  detail: {
    origin: "clawhub",
    packageName: "matrix",
    author: { handle: "branch", displayName: "Branch Agent" },
    topics: ["Matrix", "Messaging"],
    createdAt: 1_760_000_000_000,
    updatedAt: 1_780_000_000_000,
    readme: "# Matrix\n\nConnect Branch Agent to Matrix rooms and direct messages.",
    compatibility: {
      minGatewayVersion: ">=2026.5.1",
      pluginApiRange: ">=2026.5.1",
    },
    configuration: [
      {
        name: "homeserver",
        description: "Matrix homeserver URL",
        required: true,
        sensitive: false,
      },
      {
        name: "accessToken",
        description: "Matrix access token",
        required: true,
        sensitive: true,
      },
    ],
    mcpServers: [],
    skills: [{ name: "Matrix messaging", description: "Send and receive Matrix messages." }],
    versions: [
      {
        version: "2.1.0",
        createdAt: 1_780_000_000_000,
        changelog: "Current release",
        tags: ["latest"],
      },
      { version: "2.0.0", createdAt: 1_770_000_000_000, changelog: "Previous release", tags: [] },
    ],
    verification: {
      tier: "source-linked",
      summary: "Validated package structure and linked release source.",
      sourceRepo: "openclaw/openclaw",
      sourceCommit: "abc123",
      sourcePath: "extensions/matrix",
      scanStatus: "clean",
    },
    security: {
      status: "clean",
      verdict: "benign",
      auditUrl: "https://clawhub.ai/openclaw/plugins/matrix/security-audit",
      summary: "Capabilities match the stated purpose.",
      guidance: "Review the access token before enabling.",
      checkedAt: 1_780_000_000_000,
    },
  },
} satisfies PluginDiscoveryDetailResult;

const calendarDiscoveryPlugin = {
  ...matrixDiscoveryPlugin,
  id: "ch_Y2FsZW5kYXItcGx1cw",
  catalog: {
    ...matrixDiscoveryPlugin.catalog,
    name: calendarPlugin.name,
    summary: calendarPlugin.description,
    official: false,
    author: "calendar-author",
  },
};

const calendarDetail = {
  plugin: calendarDiscoveryPlugin,
  detail: {
    origin: "clawhub",
    packageName: "calendar-plus",
    topics: [],
    configuration: [],
    mcpServers: [],
    skills: [],
    versions: [],
  },
} satisfies PluginDiscoveryDetailResult;

const matrixNeedsSetup = {
  id: "matrix",
  name: "Matrix",
  packageName: "matrix",
  description: "Connect Branch Agent to Matrix rooms and direct messages.",
  version: "2.1.0",
  kind: ["channel"],
  origin: "global",
  installed: true,
  enabled: false,
  state: "needs-setup",
  category: "channel",
  removable: true,
} satisfies PluginCatalogItem;

const matrixEnabled = {
  ...matrixNeedsSetup,
  enabled: true,
  state: "enabled",
} satisfies PluginCatalogItem;

const matrixConfigSchema = {
  generatedAt: "2026-09-03T00:00:00.000Z",
  schema: {
    type: "object",
    properties: {
      plugins: {
        type: "object",
        properties: {
          entries: {
            type: "object",
            properties: {
              matrix: {
                type: "object",
                properties: {
                  enabled: { type: "boolean", title: "Enabled" },
                  config: {
                    type: "object",
                    properties: {
                      homeserver: { type: "string", title: "Homeserver" },
                      accessToken: { type: "string", title: "Access token" },
                      mode: {
                        type: ["string", "null"],
                        enum: ["auto", null],
                        title: "Mode",
                      },
                    },
                    required: ["homeserver", "accessToken"],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  uiHints: {
    "plugins.entries.matrix.config.homeserver": { advanced: false },
    "plugins.entries.matrix.config.accessToken": { advanced: false, sensitive: true },
  },
  version: "e2e",
};

const localOnlyDetail = {
  plugin: localOnlyDiscoveryPlugin,
  detail: {
    origin: "local",
    packageName: "@branch/local-calendar",
    topics: [],
    configuration: [],
    mcpServers: [],
    skills: [{ name: "Calendar planning" }],
    versions: [],
  },
} satisfies PluginDiscoveryDetailResult;

const localCalendarDisabled = {
  id: "local-calendar",
  name: "Local Calendar",
  packageName: "@branch/local-calendar",
  description: "Coordinate work using the included calendar plugin.",
  version: "1.0.0",
  kind: ["productivity"],
  origin: "official",
  installed: true,
  enabled: false,
  state: "disabled",
  category: "tool",
  removable: false,
} satisfies PluginCatalogItem;

let browser: Browser;
let server: ControlUiE2eServer;

function inventory(plugins: PluginCatalogItem[], generation = 0): PluginListResult {
  return { plugins, diagnostics: [], mutationAllowed: true, generation };
}

function configSnapshot(isCanopyEnabled: boolean) {
  const config = {
    plugins: {
      entries: {
        canopy: { enabled: isCanopyEnabled },
      },
    },
  };
  return {
    config,
    hash: isCanopyEnabled ? "plugins-config-enabled" : "plugins-config-disabled",
    issues: [],
    path: "/tmp/branch-e2e/branch.json",
    raw: JSON.stringify(config, null, 2),
    resolved: config,
    sourceConfig: config,
    valid: true,
  };
}

function readOnlyConnectResponse() {
  return {
    auth: {
      deviceToken: "plugins-read-only-device-token",
      role: "operator",
      scopes: ["operator.read"],
    },
    features: { events: [], methods: pluginMethods },
    controlUiTabs: [],
    protocol: PROTOCOL_VERSION,
    server: { connId: "plugins-read-only", version: "e2e" },
    snapshot: {
      sessionDefaults: {
        defaultAgentId: "main",
        mainKey: "main",
        mainSessionKey: "main",
        scope: "agent",
      },
    },
    type: "hello-ok",
  };
}

export function enabledCanopyCapabilities() {
  return {
    ok: true,
    generation: 1,
    descriptors: [],
    methods: pluginMethods,
    controlUiWidgetKinds: [],
    pluginSurfaceUrls: {},
    controlUiTabs: [
      {
        group: "control",
        icon: "kanban",
        id: "canopy",
        label: canopyEnabled.name,
        placement: "route:canopy",
        pluginId: "canopy",
      },
    ],
  };
}

async function captureScreenshot(
  page: Page,
  name: string,
  target: "content" | "viewport" = "content",
): Promise<void> {
  if (!updateScreenshots) {
    return;
  }
  let artifactDir = artifacts.get(page);
  if (!artifactDir) {
    artifactDir = createControlUiE2eArtifactDir("plugins");
    artifacts.set(page, artifactDir);
  }
  await (target === "viewport" ? page : page.locator(".content")).screenshot({
    animations: "disabled",
    caret: "hide",
    path: path.join(artifactDir, name),
  });
}

async function newContext(
  viewport = desktopViewport,
  options: Pick<BrowserContextOptions, "hasTouch" | "recordVideo"> = {},
): Promise<BrowserContext> {
  return browser.newContext({
    locale: "en-US",
    serviceWorkers: "block",
    viewport,
    ...options,
  });
}

function pluginMethodResponses() {
  return {
    "plugins.controlUi.list": { revision: "empty", plugins: [], diagnostics: [] },
    "config.get": configSnapshot(false),
    "plugins.list": initialInventory,
    "plugins.inspect": {
      cases: [
        { match: { pluginId: "canopy" }, response: canopyInspection },
        { match: { pluginId: "trellis" }, response: trellisInspection },
        { match: { pluginId: "calendar-plus" }, response: calendarInspection },
      ],
    },
    "plugins.search": {
      cases: [
        {
          match: { query: "calendar", limit: 20 },
          response: calendarSearchResponse,
        },
      ],
    },
    "plugins.catalog.browse": {
      cases: [
        {
          match: { intent: "all", cursor: "catalog-page-2", pageSize: 100 },
          response: {
            items: secondDiscoveryPageItems,
            nextCursor: "catalog-page-3",
          },
        },
        {
          match: { intent: "all", cursor: "catalog-page-3", pageSize: 100 },
          response: { items: finalDiscoveryPageItems },
        },
        {
          match: { intent: "official", pageSize: 100 },
          response: { items: [matrixDiscoveryPlugin] },
        },
        {
          match: { intent: "all", category: "channels", pageSize: 100 },
          response: { items: [matrixDiscoveryPlugin] },
        },
        {
          match: { intent: "all", query: "matrix", pageSize: 100 },
          response: { items: [matrixDiscoveryPlugin] },
        },
        { match: { intent: "all", pageSize: 100 }, response: discoveryResult },
      ],
    },
    "plugins.catalog.categories": discoveryCategories,
    "plugins.catalog.get": {
      cases: [
        { match: { id: matrixDiscoveryPlugin.id }, response: matrixDetail },
        { match: { id: calendarDiscoveryPlugin.id }, response: calendarDetail },
        { match: { id: localOnlyDiscoveryPlugin.id }, response: localOnlyDetail },
      ],
    },
    "plugins.install": {
      cases: [
        {
          match: {
            source: "clawhub",
            packageName: "calendar-plus",
            acknowledgeCapabilities: { reviewToken: calendarInspection.reviewToken },
          },
          response: installResult,
        },
      ],
    },
    "plugins.setEnabled": {
      cases: [
        {
          match: { pluginId: "canopy", enabled: true },
          response: enableCanopyResult,
        },
      ],
    },
    "plugins.uninstall": {
      cases: [
        {
          match: { pluginId: "calendar-plus" },
          response: uninstallResult,
        },
      ],
    },
  };
}

export async function setupPluginsE2e(): Promise<void> {
  if (!chromiumAvailable) {
    throw new Error(
      `Playwright Chromium is not installed at ${chromiumExecutablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, or set BRANCH_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
    );
  }
  server = await startControlUiE2eServer();
  browser = await chromium.launch({ executablePath: chromiumExecutablePath });
}

export async function teardownPluginsE2e(): Promise<void> {
  await browser?.close();
  await server?.close();
}

export {
  remoteIconPlugin,
  calendarDiscoveryPlugin,
  calendarInspection,
  calendarPlugin,
  changedInstallPolicyWarning,
  configSnapshot,
  installPolicyWarning,
  mobileViewport,
  canopyDisabled,
  canopyEnabled,
  captureScreenshot,
  describeControlUiE2e,
  discoveryResult,
  initialInventory,
  installMockGateway,
  inventory,
  localCalendarDisabled,
  localOnlyDiscoveryPlugin,
  matrixConfigSchema,
  matrixDiscoveryPlugin,
  matrixEnabled,
  matrixNeedsSetup,
  newContext,
  pluginMethodResponses,
  pluginMethods,
  readOnlyConnectResponse,
  server,
};
