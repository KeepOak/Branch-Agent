import { bindPluginCliProgram } from "./cli-callback-binding.js";
import { pluginInstanceState, type PluginInstanceHandle } from "./plugin-instance-scope.js";
import type { BranchPluginCliRegistrar } from "./plugin-registration.types.js";
import type { BranchPluginApi } from "./types.js";

type PluginApiFacadeFields = Pick<
  BranchPluginApi,
  "agent" | "lifecycle" | "runContext" | "session"
>;
/** Plugin API shape without nested facade namespaces attached. */
export type BranchPluginApiWithoutFacades = Omit<BranchPluginApi, keyof PluginApiFacadeFields>;
type PluginApiFacadeSource = BranchPluginApi["session"]["state"] &
  BranchPluginApi["session"]["workflow"] &
  BranchPluginApi["session"]["controls"] &
  BranchPluginApi["agent"]["events"] &
  BranchPluginApi["runContext"] &
  Pick<BranchPluginApi["lifecycle"], "registerRuntimeLifecycle">;

const identitySensitiveRegistrations = new Set([
  "registerCompactionProvider",
  "registerDecisionProvider",
  "registerGatewayAccessPolicy",
  "registerHttpRoute",
  "registerImageGenerationProvider",
  "registerMediaUnderstandingProvider",
  "registerMigrationProvider",
  "registerMusicGenerationProvider",
  "registerRealtimeTranscriptionProvider",
  "registerRealtimeVoiceProvider",
  "registerSpeechProvider",
  "registerTranscriptSourceProvider",
  "registerVideoGenerationProvider",
  "registerWebFetchProvider",
  "registerWebSearchProvider",
]);

/** Attaches nested facade namespaces to the flat plugin API implementation. */
export function attachPluginApiFacades<T extends object>(
  api: T & PluginApiFacadeSource & Partial<PluginApiFacadeFields>,
): T & PluginApiFacadeFields {
  api.session = {
    state: {
      registerSessionExtension: (...args) => api.registerSessionExtension(...args),
    },
    workflow: {
      enqueueNextTurnInjection: (...args) => api.enqueueNextTurnInjection(...args),
      registerSessionSchedulerJob: (...args) => api.registerSessionSchedulerJob(...args),
      sendSessionAttachment: (...args) => api.sendSessionAttachment(...args),
      scheduleSessionTurn: (...args) => api.scheduleSessionTurn(...args),
      unscheduleSessionTurnsByTag: (...args) => api.unscheduleSessionTurnsByTag(...args),
    },
    controls: {
      registerSessionAction: (...args) => api.registerSessionAction(...args),
      registerControlUiDescriptor: (...args) => api.registerControlUiDescriptor(...args),
    },
  };
  api.agent = {
    events: {
      registerAgentEventSubscription: (...args) => api.registerAgentEventSubscription(...args),
      emitAgentEvent: (...args) => api.emitAgentEvent(...args),
    },
  };
  api.runContext = {
    setRunContext: (...args) => api.setRunContext(...args),
    getRunContext: (...args) => api.getRunContext(...args),
    clearRunContext: (...args) => api.clearRunContext(...args),
  };
  api.lifecycle = {
    ...api.lifecycle,
    registerRuntimeLifecycle: (...args) => api.registerRuntimeLifecycle(...args),
  };
  return api as T & PluginApiFacadeFields;
}

/** Registration callbacks and their API retain the exact admitted instance. */
export function instrumentPluginInstanceApi(
  api: BranchPluginApi,
  instance?: PluginInstanceHandle,
): BranchPluginApi {
  if (!instance) {
    return api;
  }
  api.lifecycle = { ...api.lifecycle, ...instance.lifecycle };
  const instrumented = attachPluginApiFacades(
    new Proxy(api, {
      get: (target, key, receiver) => {
        const value = Reflect.get(target, key, receiver);
        if (
          typeof value !== "function" ||
          typeof key !== "string" ||
          (!key.startsWith("register") && key !== "on" && key !== "onConversationBindingResolved")
        ) {
          return value;
        }
        if (key === "registerCli" || key === "registerNodeCliFeature") {
          return (registrar: BranchPluginCliRegistrar, ...options: unknown[]) =>
            instance.run(() =>
              Reflect.apply(value, target, [
                instance.wrap((context: Parameters<BranchPluginCliRegistrar>[0]) => {
                  // Commander retains callbacks beyond this registrar's invocation.
                  // Bind at the typed host boundary, without proxying its native objects.
                  bindPluginCliProgram(context.program);
                  return registrar(context);
                }),
                ...options.map((option) => instance.wrap(option)),
              ]),
            );
        }
        return (...args: unknown[]) =>
          instance.run(() =>
            Reflect.apply(
              value,
              target,
              args.map((arg) =>
                identitySensitiveRegistrations.has(key) ? instance.adopt(arg) : instance.wrap(arg),
              ),
            ),
          );
      },
    }),
  );
  pluginInstanceState.values.setHost(instrumented, instance);
  return instrumented;
}
