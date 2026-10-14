// Command-approval trust details, ported from design/spec-v23/index.html (maskPB18, mixedPB18,
// coversPB18, carefulPB18, lookonly-pb18). Secrets show as dots; a word that mixes alphabets is
// called out; Always allow says what it covers; on desktop a command on this computer waits 1.5 s
// and a long command must be read to its end; someone without approval rights can look but not decide.
export const CAREFUL_WAIT_MS = 1500;
export const CAREFUL_READ_CHARS = 120;

/** Secrets in a command show as dots (preview maskPB18). */
export function maskCommand(text: string): string {
  return text.replace(/(Bearer\s+|token=|key=|password=)[^\s"&]+/gi, "$1••••••••");
}

/** A word that mixes Latin with Cyrillic or Greek letters (preview mixedPB18). */
export function mixedAlphabets(text: string): boolean {
  return text.split(/[^\p{L}]+/u).some((word) => /\p{Script=Latin}/u.test(word) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(word));
}

/** What Always allow covers for this exact command (preview coversPB18). */
export function alwaysAllowCover(name: string, routine?: string): string {
  return routine
    ? `Always allow lets ${name} run this exact command for ${routine} without asking, until you take it back.`
    : `Always allow lets ${name} run this exact command without asking, until you take it back.`;
}

export function isLocalHost(host?: string): boolean {
  return !host || host === "gateway";
}

export function isDesktopSurface(): boolean {
  return Boolean((window as { branchDesktop?: unknown }).branchDesktop);
}

/** Desktop, a command on this computer: allow buttons wait, and a long command must be read (preview carefulPB18). */
export function isCarefulCommand(opts: { desktop?: boolean; plugin?: boolean; host?: string }): boolean {
  return Boolean(opts.desktop) && !opts.plugin && isLocalHost(opts.host);
}

export function reachedEnd(el: Pick<Element, "scrollTop" | "clientHeight" | "scrollHeight">): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
}

/** Someone without approval rights can look but not decide (preview S.person !== 0). Empty scopes stay decidable. */
export function canDecideApprovals(canDecide?: boolean, scopes?: readonly string[]): boolean {
  if (canDecide === false) return false;
  if (canDecide === true) return true;
  if (!scopes?.length) return true;
  return scopes.includes("operator.admin") || scopes.includes("operator.approvals");
}
