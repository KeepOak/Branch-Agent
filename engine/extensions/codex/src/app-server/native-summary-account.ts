import { resolveCodexAppServerRuntimeOptions } from "./config-runtime.js";
import { readCodexNativeAccounts, projectCodexNativeAccount } from "./native-accounts.js";
import { probeCodexNativeAuth } from "./native-auth.js";
import { summarizeCodexAccountUsage } from "./rate-limits.js";
import { requestCodexAppServerJson } from "./request.js";

/** Select only the new, tool-free summary's home; never change source thread ownership. */
export async function selectCodexNativeSummaryAccount(params: {
  pluginConfig?: unknown;
  capturedHome?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  assertActive: () => void;
}): Promise<unknown> {
  const assertActive = () => {
    params.signal?.throwIfAborted();
    params.assertActive();
  };
  assertActive();
  const registry = readCodexNativeAccounts(params.pluginConfig);
  if (!params.capturedHome) {
    if (registry) {
      throw new Error("Codex settled summary has no captured native account owner");
    }
    return params.pluginConfig;
  }
  const owner = registry?.accounts.find(({ home }) => home === params.capturedHome);
  if (!registry || !owner) {
    throw new Error("Codex thread native account owner is no longer registered");
  }
  // Defaults are irrelevant to settled evidence. Rotate only before launching
  // this independent summary, never by resuming/replacing the source thread.
  const candidates = registry.quotaFailover
    ? [owner, ...registry.accounts.filter(({ home }) => home !== owner.home)]
    : [owner];
  const deadline = performance.now() + Math.min(params.timeoutMs, 10_000);
  for (const candidate of candidates) {
    assertActive();
    if (performance.now() >= deadline) {
      throw new Error("Codex native summary account inspection timed out");
    }
    const pluginConfig = projectCodexNativeAccount(registry.config, candidate.home);
    const auth = await probeCodexNativeAuth({ pluginConfig, signal: params.signal });
    assertActive();
    // Native ChatGPT login, not API-key, PAT/access-token or Branch profile auth.
    if (auth?.nativeAuth?.mode !== "oauth") {
      throw new Error("Codex native summary account requires its own ChatGPT subscription login");
    }
    const timeoutMs = deadline - performance.now();
    if (timeoutMs <= 0) {
      throw new Error("Codex native summary account inspection timed out");
    }
    const { start } = resolveCodexAppServerRuntimeOptions({ pluginConfig });
    const rateLimits = await requestCodexAppServerJson({
      startOptions: start,
      authProfileId: null,
      isolated: true,
      method: "account/rateLimits/read",
      timeoutMs,
      signal: params.signal,
      assertCurrent: assertActive,
    });
    assertActive();
    const status = summarizeCodexAccountUsage(rateLimits);
    if (!status) {
      throw new Error("Codex native summary account quota is unavailable");
    }
    if (status.blocked === true) {
      continue;
    }
    // Caller launches at most one summary. Its failures are never retried here.
    return pluginConfig;
  }
  throw new Error("All eligible Codex native summary accounts report exhausted quota");
}
