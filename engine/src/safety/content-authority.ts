// Branch-original shared safety piece (atlas SAFETY-0196, G-1642): forwarded content never grants authority.
// Wired in auto-reply/reply/inbound-context.ts: a forwarded message is literal content.

export type ForwardFacts = Readonly<{
  ForwardedFrom?: string;
  ForwardedFromId?: string;
  ForwardedFromType?: string;
  ForwardedDate?: number;
}>;

/**
 * G-1642: a forwarded message's body is someone else's words. The sender stays the person who forwarded it,
 * and its text is never read as a slash command or an approval reply.
 */
export function isForwardedContent(ctx: ForwardFacts): boolean {
  return Boolean(
    ctx.ForwardedFrom?.trim() ||
      ctx.ForwardedFromId?.trim() ||
      ctx.ForwardedFromType?.trim() ||
      ctx.ForwardedDate !== undefined,
  );
}
