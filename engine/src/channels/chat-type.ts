/**
 * Channel conversation kind normalization.
 *
 * Maps channel-specific direct/group/channel labels into Branch Agent chat types.
 */
import { normalizeOptionalLowercaseString } from "@branch/normalization-core/string-coerce";

/**
 * Normalized conversation kind shared by channel routing, sessions, and SDK helpers.
 */
export type ChatType = "direct" | "group" | "channel";

/**
 * Normalizes channel-specific chat type labels into Branch Agent conversation kinds.
 */
export function normalizeChatType(raw?: string): ChatType | undefined {
  const value = normalizeOptionalLowercaseString(raw);
  if (value === "dm") {
    return "direct";
  }
  return value === "direct" || value === "group" || value === "channel" ? value : undefined;
}
