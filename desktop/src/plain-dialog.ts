// Private #1089: a native error box has no level and no Details fold, so it never shows raw error text. Branch's own
// written sentences (the busy refusal, for one) are already plain and pass as they are; anything raw (a stack, an error
// class or code name, a path, a host or a URL) becomes the box's plain fallback, and the raw text stays in the log.
import { TRUNKS_STILL_WORKING } from "./service-update";

/** Sentences Branch writes for the owner; they always pass as they are. */
const KNOWN_PLAIN = new Set<string>([TRUNKS_STILL_WORKING]);

/** The update box's fallback when the failure text is raw. */
export const UPDATE_FAILED_PLAIN = "Branch keeps the version it has. Try the update again later; the details are in its log.";
/** The Stop completely box's fallback when the failure text is raw. */
export const STOP_FAILED_PLAIN = "Try again in a moment, or restart this computer. The details are in Branch's log.";

const RAW_SIGNS: RegExp[] = [
  /\n/, // more than one line: a stack, a log tail, a dump
  /^\s*at\s/m, // a stack frame
  /\b[A-Z]\w*(?:Error|Exception)\b/, // an error class name: TypeError, GatewayReadinessTimeoutError
  /\b(?:E[A-Z0-9]{2,}|ERR_[A-Z0-9_]+)\b/, // an error code name: ENOENT, EADDRINUSE, ERR_INVALID_ARG_TYPE
  /:\/\//, // a URL
  /(?:^|[\s("'=])(?:~|\.{1,2})?\/[\w.@~-]/, // a POSIX path: /home/..., ./dist, ~/x
  /\b[A-Za-z]:[\\/]/, // a Windows drive path: C:\Users
  /\\[\w.$-]+\\/, // a Windows path segment or UNC share
  /\blocalhost\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[[0-9a-f:]+\]/i, // a host: localhost, an IPv4 or IPv6 address
  /\b[\w-]+(?:\.[\w-]+)+:\d+\b|:\d{2,5}\b/, // a host:port
  /\b[\w-]+\.(?:js|mjs|cjs|ts|json|exe|plist|service|log|lock|txt|zip|dll|node)\b/i, // a file name
  /[{}<>`$]|=>/, // code or a template
  /\bpid\s*\d+|\bexit(?:ed)?\s+(?:with\s+)?(?:(?:code|status)\s*)?-?\d+/i, // a process id or exit code
];

/** True when the text names nothing raw: no stack, error class or code name, path, host or URL. */
export function isPlainSentence(text: string): boolean {
  const trimmed = text.trim();
  if (KNOWN_PLAIN.has(trimmed)) return true;
  if (!trimmed || trimmed.length > 240) return false;
  return !RAW_SIGNS.some(sign => sign.test(trimmed));
}

/** What an error box shows for a failure: Branch's own plain sentence as it is, or the plain fallback for raw text. */
export function plainDialogText(message: string, fallback: string): string {
  return isPlainSentence(message) ? message.trim() : fallback;
}
