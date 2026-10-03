import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export type TelegramChannelConfig = NonNullable<
  NonNullable<BranchConfig["channels"]>["telegram"]
>;

export function makeTelegramConfig(
  telegram: TelegramChannelConfig,
  config: Omit<BranchConfig, "channels"> = {},
): BranchConfig {
  return {
    ...config,
    messages: {
      ...config.messages,
      inbound: { debounceMs: 0, ...config.messages?.inbound },
    },
    channels: { telegram },
  };
}

export function makeDirectTelegramConfig(
  storePath: string,
  telegramOverrides: TelegramChannelConfig = {},
): BranchConfig {
  return makeTelegramConfig(
    { dmPolicy: "open", allowFrom: ["*"], ...telegramOverrides },
    { session: { store: storePath } },
  );
}
