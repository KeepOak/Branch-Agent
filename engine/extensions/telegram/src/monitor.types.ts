import type {
  ChannelAccountSnapshot,
  ChannelRuntimeSurface,
} from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { RuntimeEnv } from "branch/plugin-sdk/runtime-env";
import type { TelegramBotInfo } from "./bot-info.js";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  ownerAgentId?: string;
  config?: BranchConfig;
  runtime?: RuntimeEnv;
  channelRuntime?: ChannelRuntimeSurface;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  legacyWebhook?: false | { port: number; host?: string };
  webhookSecret?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
  botInfo?: TelegramBotInfo;
  setStatus?: (patch: Omit<ChannelAccountSnapshot, "accountId">) => void;
};

export type TelegramMonitorFn = (opts?: MonitorTelegramOpts) => Promise<void>;
