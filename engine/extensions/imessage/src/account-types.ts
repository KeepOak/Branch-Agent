import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<BranchConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
