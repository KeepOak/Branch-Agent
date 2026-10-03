export { readStringOrNumberParam, readStringParam } from "branch/plugin-sdk/channel-actions";
export type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export { resolveReactionMessageId } from "branch/plugin-sdk/channel-actions";
export { handleWhatsAppAction } from "./action-runtime.js";
export { resolveAuthorizedWhatsAppOutboundTarget } from "./action-runtime-target-auth.js";
export { resolveWhatsAppAccount, resolveWhatsAppMediaMaxBytes } from "./accounts.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize-target.js";
export { sendWhatsAppUploadFile as sendMessageWhatsApp } from "./send.js";
