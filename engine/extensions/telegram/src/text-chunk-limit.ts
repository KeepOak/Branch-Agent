import type { OutboundDeliveryFormattingOptions } from "branch/plugin-sdk/channel-outbound";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveTextChunkLimit } from "branch/plugin-sdk/reply-chunking";
import { TELEGRAM_RICH_TEXT_LIMIT } from "./rich-message.js";
import { resolveTelegramRichMessages } from "./rich-messages-config.js";

export const TELEGRAM_TEXT_CHUNK_LIMIT = 4000;

export function resolveTelegramTextChunkLimit(params: {
  cfg: BranchConfig;
  accountId?: string | null;
  formatting?: OutboundDeliveryFormattingOptions;
}): number {
  const platformLimit = resolveTelegramRichMessages({
    cfg: params.cfg,
    accountId: params.accountId,
    htmlTextMode: params.formatting?.parseMode === "HTML",
  })
    ? TELEGRAM_RICH_TEXT_LIMIT
    : TELEGRAM_TEXT_CHUNK_LIMIT;
  return Math.min(
    resolveTextChunkLimit(params.cfg, "telegram", params.accountId ?? undefined, {
      fallbackLimit: platformLimit,
    }),
    platformLimit,
  );
}
