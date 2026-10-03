import type { EmbeddedRunAttemptParamsV2 } from "branch/plugin-sdk/agent-harness-runtime";
import { resolveCodexAppServerRuntimeOptions } from "./config-runtime.js";
import {
  projectCodexNativeAccount,
  readCodexNativeAccounts,
  selectCodexNativeAccount,
} from "./native-accounts.js";
import { probeCodexNativeAuth } from "./native-auth.js";
import { summarizeCodexAccountUsage } from "./rate-limits.js";
import { requestCodexAppServerJson } from "./request.js";
import type { CodexRunAttemptOptions } from "./run-attempt-types.js";
import { sessionBindingIdentity, type CodexAppServerBindingStore } from "./session-binding.js";

export function nativeAccountBindingStore(
  store: CodexAppServerBindingStore,
  home: string,
): CodexAppServerBindingStore {
  const assertOwner = (binding: ReturnType<CodexAppServerBindingStore["read"]>) => {
    if (binding && binding.nativeAccountHome !== home) {
      throw new Error("Codex native account ownership changed before thread admission");
    }
    return binding;
  };
  return {
    ...store,
    read: (identity) => assertOwner(store.read(identity)),
    readMany: async function* (identities) {
      for await (const binding of store.readMany(identities)) {
        yield assertOwner(binding);
      }
      return undefined;
    },
    mutate: (identity, mutation, assertCurrent) => {
      const owned =
        mutation.kind === "set" || mutation.kind === "replace-thread"
          ? { ...mutation, binding: { ...mutation.binding, nativeAccountHome: home } }
          : mutation.kind === "patch"
            ? { ...mutation, patch: { ...mutation.patch, nativeAccountHome: home } }
            : mutation;
      return store.mutate(identity, owned, () => {
        assertCurrent?.();
        assertOwner(store.read(identity));
      });
    },
  };
}

export function projectBoundCodexNativeAccount(value: unknown, home: string | undefined): unknown {
  if (!home) return value;
  const registry = readCodexNativeAccounts(value);
  if (!registry || !registry.accounts.some((account) => account.home === home)) {
    throw new Error("Codex thread native account owner is no longer registered");
  }
  return projectCodexNativeAccount(registry.config, home);
}

export async function runWithCodexNativeAccount<T>(
  params: EmbeddedRunAttemptParamsV2,
  options: CodexRunAttemptOptions,
  run: (options: CodexRunAttemptOptions) => Promise<T>,
): Promise<T> {
  if (!readCodexNativeAccounts(options.pluginConfig)) return run(options);
  if (params.authProfileId || params.sandbox?.enabled || params.expectedSessionRuntimeOwnership) {
    throw new Error(
      "Codex native account registry cannot replace profile, sandbox or native ownership authority",
    );
  }
  const binding = options.bindingStore.read(sessionBindingIdentity(params));
  return selectCodexNativeAccount({
    value: options.pluginConfig,
    bindingHome: binding?.nativeAccountHome,
    hasBinding: Boolean(binding),
    signal: params.abortSignal,
    inspect: async (pluginConfig) => {
      params.hostCapabilities.assertActive();
      const auth = await probeCodexNativeAuth({ pluginConfig, signal: params.abortSignal });
      if (!auth || auth.nativeAuth?.mode === "api-key") {
        return { authenticated: false, blocked: undefined };
      }
      const { start } = resolveCodexAppServerRuntimeOptions({ pluginConfig });
      const rateLimits = await requestCodexAppServerJson({
        startOptions: start,
        // Native login is the only authority. Never import or apply a Branch profile.
        authProfileId: null,
        isolated: true,
        method: "account/rateLimits/read",
        timeoutMs: Math.min(params.timeoutMs, 10_000),
        signal: params.abortSignal,
        assertCurrent: params.hostCapabilities.assertActive,
      });
      return { authenticated: true, blocked: summarizeCodexAccountUsage(rateLimits)?.blocked };
    },
    run: (pluginConfig, home) => {
      params.hostCapabilities.assertActive();
      return run({
        ...options,
        pluginConfig,
        bindingStore: nativeAccountBindingStore(options.bindingStore, home),
      });
    },
  });
}
