// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/community/aio_sandbox/local_backend.py (atlas SAFETY-0044)
/**
 * Docker resources for restricted sandbox networking.
 *
 * The sandbox joins an internal-only bridge network. A trusted proxy sidecar joins that
 * network and a separate egress network, and is the sandbox's only route out.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveRuntimeProcessEntrypointUrl } from "../../../infra/runtime-process-url.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { execContainer, type SandboxContainerEngine } from "../container-engine.js";
import { containerState, readContainerLabel } from "../container-inspect.js";
import type { ResolvedSandboxNetworkPolicy } from "./network-config.js";
import {
  NETWORK_PROXY_ENV,
  type NetworkPolicyDecision,
  type NetworkPolicyEvent,
} from "./network-proxy-policy.js";
import { NETWORK_PROXY_PORT } from "./network-proxy.js";

const log = createSubsystemLogger("sandbox/network-proxy");

const NETWORK_POLICY_DIGEST_LABEL = "branch.networkPolicyDigest";
const NETWORK_GATEWAY_MODE_IPV4 = "com.docker.network.bridge.gateway_mode_ipv4";
const NETWORK_GATEWAY_MODE_IPV6 = "com.docker.network.bridge.gateway_mode_ipv6";
const NETWORK_ENABLE_ICC = "com.docker.network.bridge.enable_icc";
const PROXY_EXCLUDE = "localhost,127.0.0.1,::1";
const NODE_ARGS = ["node", "--disable-warning=ExperimentalWarning"] as const;
const SIDECAR_SCRIPT_DIR = "/tmp";
const SIDECAR_SOURCE_MODULES = ["network-proxy-policy", "network-proxy-http"] as const;

type SidecarFile = { name: string; content: string };

export type SandboxNetworkProxyResources = {
  proxyName: string;
  networkName: string;
  egressNetworkName: string;
};

export type SandboxNetworkProxyAttachment = {
  network: string;
  env: Record<string, string>;
};

export function resolveSandboxNetworkProxyResources(
  containerName: string,
): SandboxNetworkProxyResources {
  const digest = createHash("sha256").update(containerName).digest("hex").slice(0, 16);
  return {
    proxyName: `branch-netproxy-${digest}`,
    networkName: `branch-sandbox-net-${digest}`,
    egressNetworkName: `branch-sandbox-egress-${digest}`,
  };
}

function networkProxyScriptUrl(): URL {
  return resolveRuntimeProcessEntrypointUrl("sandboxNetworkProxy");
}

function isSourceCheckout(url: URL): boolean {
  return url.pathname.endsWith(".ts");
}

function entryScriptName(url: URL): string {
  return isSourceCheckout(url) ? "branch-network-proxy.mts" : "branch-network-proxy.mjs";
}

/** Built engines ship one bundled script; source checkouts ship TypeScript Node can strip. */
export function networkProxyContainerScriptPath(url = networkProxyScriptUrl()): string {
  return `${SIDECAR_SCRIPT_DIR}/${entryScriptName(url)}`;
}

/** Reads the sidecar files; the entry is last so the start loop only sees a complete set. */
async function loadSidecarFiles(url: URL): Promise<SidecarFile[]> {
  const entry = {
    name: entryScriptName(url),
    content: await fs.readFile(fileURLToPath(url), "utf8"),
  };
  if (!isSourceCheckout(url)) {
    return [entry];
  }
  // Node resolves sibling TypeScript modules only by their real extension.
  const rewrite = (text: string) =>
    text.replace(/"\.\/(network-proxy-(?:policy|http))\.js"/gu, '"./$1.mts"');
  const modules = await Promise.all(
    SIDECAR_SOURCE_MODULES.map(async (name) => ({
      name: `${name}.mts`,
      content: rewrite(await fs.readFile(fileURLToPath(new URL(`./${name}.ts`, url)), "utf8")),
    })),
  );
  return [...modules, { ...entry, content: rewrite(entry.content) }];
}

export function isRestrictedSandboxNetwork(policy: ResolvedSandboxNetworkPolicy): boolean {
  return policy.mode !== "open";
}

function timeout(ms: number): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(ms) };
}

async function requireRestrictedNetworkSupport(engine: SandboxContainerEngine): Promise<void> {
  if (engine.id !== "docker") {
    throw new Error(
      "sandbox.docker.networkPolicy restricted modes require Docker; Podman is not supported",
    );
  }
  let major: number;
  try {
    const result = await execContainer(
      engine,
      ["version", "--format", "{{.Server.Version}}"],
      timeout(10_000),
    );
    major = Number.parseInt(result.stdout.trim().split(".", 1)[0] ?? "", 10);
  } catch (error) {
    throw new Error(
      "sandbox.docker.networkPolicy restricted modes require a reachable Docker Engine 28 or newer",
      { cause: error },
    );
  }
  if (!Number.isFinite(major) || major < 28) {
    throw new Error(
      "sandbox.docker.networkPolicy restricted modes require Docker Engine 28 or newer so both internal bridge gateway families can use isolated mode",
    );
  }
}

let dockerServerIsDesktopCache: boolean | undefined;

/** Detect Desktop from the daemon, including a Linux Docker-outside-of-Docker Gateway. */
async function dockerServerIsDesktop(engine: SandboxContainerEngine): Promise<boolean> {
  if (dockerServerIsDesktopCache !== undefined) {
    return dockerServerIsDesktopCache;
  }
  const result = await execContainer(engine, ["info", "--format", "{{json .OperatingSystem}}"], {
    allowFailure: true,
    ...timeout(10_000),
  }).catch((error: unknown) => ({ code: 1, stdout: "", stderr: String(error) }));
  if (result.code !== 0) {
    log.warn(
      `Could not identify the Docker server platform; assuming non-Desktop: ${result.stderr.trim()}`,
    );
    return false;
  }
  let operatingSystem: unknown = result.stdout.trim();
  try {
    operatingSystem = JSON.parse(String(operatingSystem));
  } catch {
    // Older daemons print the raw value.
  }
  dockerServerIsDesktopCache =
    typeof operatingSystem === "string" && operatingSystem.toLowerCase().includes("docker desktop");
  return dockerServerIsDesktopCache;
}

function networkPolicyDigest(params: {
  policy: ResolvedSandboxNetworkPolicy;
  allowSyntheticDns: boolean;
  proxySource: string;
}): string {
  const { policy } = params;
  // Keys are listed in sorted order so the digest matches a canonical JSON encoding.
  const material = {
    allow_domains: [...new Set(policy.allowDomains)].toSorted(),
    allow_synthetic_dns: params.allowSyntheticDns,
    approval: policy.approval,
    egress_network: { driver: "bridge", enable_icc: false, internal: false },
    mode: policy.mode,
    network: {
      driver: "bridge",
      gateway_mode_ipv4: "isolated",
      gateway_mode_ipv6: "isolated",
      internal: true,
    },
    proxy_image: policy.proxyImage,
    proxy_source_sha256: createHash("sha256").update(params.proxySource).digest("hex"),
    schema: 1,
    temporary_grant_ttl: policy.temporaryGrantTtl,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function restrictedLabels(params: {
  containerName: string;
  role: string;
  policy: ResolvedSandboxNetworkPolicy;
  digest: string;
}): string[] {
  const labels: Record<string, string> = {
    "branch.sandboxContainer": params.containerName,
    "branch.role": params.role,
    "branch.networkMode": params.policy.mode,
    [NETWORK_POLICY_DIGEST_LABEL]: params.digest,
  };
  return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

async function runOrThrow(
  engine: SandboxContainerEngine,
  args: string[],
  failure: string,
  options: { timeoutMs: number; input?: Buffer },
): Promise<void> {
  const result = await execContainer(engine, args, {
    allowFailure: true,
    input: options.input,
    ...timeout(options.timeoutMs),
  });
  if (result.code !== 0) {
    throw new Error(`${failure}: ${result.stderr.trim()}`);
  }
}

async function networkExists(engine: SandboxContainerEngine, name: string): Promise<boolean> {
  const result = await execContainer(engine, ["network", "inspect", name], {
    allowFailure: true,
    ...timeout(15_000),
  });
  return result.code === 0;
}

type RestrictedContext = {
  engine: SandboxContainerEngine;
  containerName: string;
  policy: ResolvedSandboxNetworkPolicy;
  resources: SandboxNetworkProxyResources;
  digest: string;
  allowSyntheticDns: boolean;
  proxySource: string;
  sidecarFiles: SidecarFile[];
  scriptPath: string;
};

async function createInternalNetwork(ctx: RestrictedContext): Promise<void> {
  const labels = restrictedLabels({ ...ctx, role: "network" });
  await runOrThrow(
    ctx.engine,
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--internal",
      "--opt",
      `${NETWORK_GATEWAY_MODE_IPV4}=isolated`,
      "--opt",
      `${NETWORK_GATEWAY_MODE_IPV6}=isolated`,
      ...labels,
      ctx.resources.networkName,
    ],
    "Failed to create restricted sandbox network",
    { timeoutMs: 15_000 },
  );
}

async function createEgressNetwork(ctx: RestrictedContext): Promise<void> {
  const labels = restrictedLabels({ ...ctx, role: "egress-network" });
  await runOrThrow(
    ctx.engine,
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--opt",
      `${NETWORK_ENABLE_ICC}=false`,
      ...labels,
      ctx.resources.egressNetworkName,
    ],
    "Failed to create restricted sandbox egress network",
    { timeoutMs: 15_000 },
  );
}

function proxyCreateArgs(ctx: RestrictedContext): string[] {
  const recordDenials = ctx.policy.mode === "allowlist" && ctx.policy.approval === "prompt";
  return [
    "create",
    "--rm",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "256m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--user",
    "65532:65532",
    "--network",
    ctx.resources.egressNetworkName,
    "--name",
    ctx.resources.proxyName,
    ...restrictedLabels({ ...ctx, role: "network-proxy" }),
    "-e",
    `${NETWORK_PROXY_ENV.mode}=${ctx.policy.mode}`,
    "-e",
    `${NETWORK_PROXY_ENV.allowDomainsJson}=${JSON.stringify(ctx.policy.allowDomains)}`,
    "-e",
    `${NETWORK_PROXY_ENV.allowSyntheticDns}=${ctx.allowSyntheticDns ? "1" : "0"}`,
    "-e",
    `${NETWORK_PROXY_ENV.recordDenials}=${recordDenials ? "1" : "0"}`,
    ctx.policy.proxyImage,
    "sh",
    "-c",
    `while [ ! -f ${ctx.scriptPath} ]; do sleep 0.05; done; exec ${NODE_ARGS.join(" ")} ${ctx.scriptPath} serve`,
  ];
}

function installScriptCode(): string {
  const dir = JSON.stringify(SIDECAR_SCRIPT_DIR);
  return `const fs=require("node:fs");for(const f of JSON.parse(fs.readFileSync(0,"utf8"))){const p=${dir}+"/"+f.name;fs.writeFileSync(p+".tmp",f.content);fs.renameSync(p+".tmp",p);}`;
}

async function startNetworkProxy(ctx: RestrictedContext): Promise<void> {
  const { engine, resources } = ctx;
  // First use may pull the sidecar image. Match the sandbox create path's
  // tolerance for an image download instead of killing Docker mid-pull.
  await runOrThrow(engine, proxyCreateArgs(ctx), "Failed to create sandbox network proxy", {
    timeoutMs: 300_000,
  });
  await runOrThrow(
    engine,
    ["network", "connect", resources.networkName, resources.proxyName],
    "Failed to connect sandbox network proxy",
    { timeoutMs: 15_000 },
  );
  await runOrThrow(
    engine,
    ["start", resources.proxyName],
    "Failed to start sandbox network proxy",
    {
      timeoutMs: 15_000,
    },
  );
  await runOrThrow(
    engine,
    ["exec", "-i", resources.proxyName, "node", "-e", installScriptCode()],
    "Failed to install sandbox network proxy",
    { timeoutMs: 15_000, input: Buffer.from(JSON.stringify(ctx.sidecarFiles), "utf8") },
  );
}

async function loadRestrictedContext(params: {
  engine: SandboxContainerEngine;
  containerName: string;
  policy: ResolvedSandboxNetworkPolicy;
}): Promise<RestrictedContext> {
  await requireRestrictedNetworkSupport(params.engine);
  const allowSyntheticDns = await dockerServerIsDesktop(params.engine);
  const scriptUrl = networkProxyScriptUrl();
  const sidecarFiles = await loadSidecarFiles(scriptUrl);
  const proxySource = sidecarFiles.map((file) => file.content).join("\n");
  return {
    ...params,
    resources: resolveSandboxNetworkProxyResources(params.containerName),
    digest: networkPolicyDigest({ policy: params.policy, allowSyntheticDns, proxySource }),
    allowSyntheticDns,
    proxySource,
    sidecarFiles,
    scriptPath: networkProxyContainerScriptPath(scriptUrl),
  };
}

function proxyEnvironment(proxyName: string): Record<string, string> {
  const proxyUrl = `http://${proxyName}:${NETWORK_PROXY_PORT}`;
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: PROXY_EXCLUDE,
    no_proxy: PROXY_EXCLUDE,
  };
}

/** Creates fresh networks and a proxy sidecar for a sandbox container about to be created. */
export async function prepareSandboxNetworkProxy(params: {
  engine: SandboxContainerEngine;
  containerName: string;
  policy: ResolvedSandboxNetworkPolicy;
}): Promise<SandboxNetworkProxyAttachment> {
  const ctx = await loadRestrictedContext(params);
  // The container lifecycle lock serializes this name; stale resources from an
  // earlier generation are replaced rather than adopted.
  await removeSandboxNetworkProxyResources(params.engine, params.containerName);
  try {
    await createInternalNetwork(ctx);
    await createEgressNetwork(ctx);
    await startNetworkProxy(ctx);
  } catch (error) {
    await removeSandboxNetworkProxyResources(params.engine, params.containerName);
    throw error;
  }
  return { network: ctx.resources.networkName, env: proxyEnvironment(ctx.resources.proxyName) };
}

/** Restarts the sidecar for an existing restricted sandbox when it is missing or stale. */
export async function ensureSandboxNetworkProxyRunning(params: {
  engine: SandboxContainerEngine;
  containerName: string;
  policy: ResolvedSandboxNetworkPolicy;
}): Promise<void> {
  const ctx = await loadRestrictedContext(params);
  const { engine, resources } = ctx;
  const state = await containerState(engine, resources.proxyName);
  if (
    state.running &&
    (await readContainerLabel(engine, resources.proxyName, NETWORK_POLICY_DIGEST_LABEL)) ===
      ctx.digest
  ) {
    return;
  }
  await execContainer(engine, ["rm", "-f", resources.proxyName], {
    allowFailure: true,
    ...timeout(15_000),
  });
  if (!(await networkExists(engine, resources.networkName))) {
    await createInternalNetwork(ctx);
  }
  if (!(await networkExists(engine, resources.egressNetworkName))) {
    await createEgressNetwork(ctx);
  }
  await startNetworkProxy(ctx);
}

/** Removes the sidecar and both networks; absent resources are not an error. */
export async function removeSandboxNetworkProxyResources(
  engine: SandboxContainerEngine,
  containerName: string,
): Promise<void> {
  const resources = resolveSandboxNetworkProxyResources(containerName);
  // `--rm` removes a container after it has run and then stopped, but not one
  // left in the Created state by a failure before start.
  const removed = await execContainer(engine, ["rm", "-f", resources.proxyName], {
    allowFailure: true,
    ...timeout(15_000),
  });
  if (removed.code !== 0 && !/no such container/iu.test(removed.stderr)) {
    log.warn(
      `Failed to remove sandbox network proxy ${resources.proxyName}: ${removed.stderr.trim()}`,
    );
  }
  for (const network of [resources.networkName, resources.egressNetworkName]) {
    const result = await execContainer(engine, ["network", "rm", network], {
      allowFailure: true,
      ...timeout(15_000),
    });
    if (result.code !== 0 && !/not found/iu.test(result.stderr)) {
      log.warn(`Failed to remove sandbox network ${network}: ${result.stderr.trim()}`);
    }
  }
}

export type SandboxNetworkPolicyClient = {
  consumeEvents: () => Promise<NetworkPolicyEvent[]>;
  denyPendingEvents: () => Promise<boolean>;
  decide: (requestId: string, decision: NetworkPolicyDecision) => Promise<boolean>;
};

function parsePolicyEvents(stdout: string, containerName: string): NetworkPolicyEvent[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    log.warn(`Sandbox network proxy returned invalid policy events for ${containerName}`);
    return [];
  }
  return Array.isArray(payload)
    ? payload.filter(
        (event): event is NetworkPolicyEvent => typeof event === "object" && event !== null,
      )
    : [];
}

/** Talks to the sidecar policy store through the container engine. */
export function createSandboxNetworkPolicyClient(params: {
  engine: SandboxContainerEngine;
  containerName: string;
  temporaryGrantTtl: number;
}): SandboxNetworkPolicyClient {
  const { proxyName } = resolveSandboxNetworkProxyResources(params.containerName);
  const run = (...args: string[]) =>
    execContainer(
      params.engine,
      ["exec", proxyName, ...NODE_ARGS, networkProxyContainerScriptPath(), ...args],
      { allowFailure: true, ...timeout(10_000) },
    );
  return {
    async consumeEvents() {
      const result = await run("pending");
      if (result.code !== 0) {
        log.warn(
          `Failed to read sandbox network policy events for ${params.containerName}: ${result.stderr.trim()}`,
        );
        return [];
      }
      return parsePolicyEvents(result.stdout, params.containerName);
    },
    async denyPendingEvents() {
      const result = await run("deny-pending");
      if (result.code !== 0) {
        log.warn(
          `Failed to deny pending sandbox network policy events for ${params.containerName}: ${result.stderr.trim()}`,
        );
      }
      return result.code === 0;
    },
    async decide(requestId, decision) {
      const ttl = String(params.temporaryGrantTtl);
      return (await run("decide", requestId, decision, "--ttl", ttl)).code === 0;
    },
  };
}
