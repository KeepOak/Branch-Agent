import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

type SignalChannelConfig = Exclude<NonNullable<BranchConfig["channels"]>["signal"], undefined>;

export type SignalAccountConfig = Omit<SignalChannelConfig, "accounts" | "defaultAccount">;

export type SignalTransportConfig = NonNullable<SignalChannelConfig["transport"]>;
