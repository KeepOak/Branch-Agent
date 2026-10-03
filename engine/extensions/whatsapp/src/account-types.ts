import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<BranchConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
