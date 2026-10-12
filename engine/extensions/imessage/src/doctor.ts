import type { ChannelDoctorAdapter } from "branch/plugin-sdk/channel-contract";
import { collectIMessageDuplicateAccountSourceWarnings } from "./accounts.js";

export const imessageDoctor: ChannelDoctorAdapter = {
  groupAllowFromFallbackToAllowFrom: false,
  collectPreviewWarnings: ({ cfg }) => collectIMessageDuplicateAccountSourceWarnings({ cfg }),
};
