import { readChannelAllowFromStore } from "branch/plugin-sdk/conversation-runtime";
import { createLazyRuntimeMethodBinder } from "branch/plugin-sdk/lazy-runtime";
import type {
  ModelsAuthLoginFlowOptions,
  ModelsAuthLoginFlowResult,
} from "branch/plugin-sdk/provider-auth-login-flow-runtime";
import { getRuntimeConfig } from "branch/plugin-sdk/runtime-config-snapshot";
import { listSkillCommandsForAgents } from "branch/plugin-sdk/skill-commands-runtime";
import type { TelegramBotDeps } from "./bot-deps.js";
import { syncTelegramMenuCommands } from "./bot-native-command-menu.js";
import { loadTelegramSendModule } from "./send-runtime.js";

export type TelegramNativeCommandDeps = Pick<
  TelegramBotDeps,
  | "editMessageTelegram"
  | "getRuntimeConfig"
  | "listSkillCommandsForAgents"
  | "readChannelAllowFromStore"
  | "syncTelegramMenuCommands"
> & {
  runModelsAuthLoginFlow?: (opts: ModelsAuthLoginFlowOptions) => Promise<ModelsAuthLoginFlowResult>;
  sendMessageTelegram: typeof import("./send.js").sendMessageTelegram;
};

const bindSend = createLazyRuntimeMethodBinder(loadTelegramSendModule);

export const defaultTelegramNativeCommandDeps: TelegramNativeCommandDeps = {
  getRuntimeConfig,
  readChannelAllowFromStore,
  listSkillCommandsForAgents,
  syncTelegramMenuCommands,
  async runModelsAuthLoginFlow(opts) {
    const { runModelsAuthLoginFlow } =
      await import("branch/plugin-sdk/provider-auth-login-flow-runtime");
    return await runModelsAuthLoginFlow(opts);
  },
  editMessageTelegram: bindSend((runtime) => runtime.editMessageTelegram),
  sendMessageTelegram: bindSend((runtime) => runtime.sendMessageTelegram),
};
