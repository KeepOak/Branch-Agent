/** Maps browser tool actions onto guest operations and checks their arguments. */
import type { GuestOp } from "./guest-registry.js";

export const GUEST_ADDRESS_REFUSAL = "That address isn't allowed in the browser.";
const GUEST_ACT_KINDS = ["click", "type", "press", "scroll"] as const;

/** The subset of a browser act request the guest pane can perform. */
export type GuestActInput = {
  kind?: unknown;
  x?: unknown;
  y?: unknown;
  text?: unknown;
  key?: unknown;
  dy?: unknown;
};

export type GuestArgsResult = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

export function toGuestOp(action: string): GuestOp | undefined {
  switch (action) {
    case "tabs":
      return "tabs";
    case "navigate":
      return "navigate";
    case "snapshot":
    case "text":
      return "read";
    case "act":
      return "act";
    case "screenshot":
      return "screenshot";
    default:
      return undefined;
  }
}

/** Only http, https and about:blank may reach the guest pane. */
export function isAllowedGuestUrl(url: string): boolean {
  const parsed = URL.parse(url.trim());
  if (!parsed) {
    return false;
  }
  if (parsed.href === "about:blank") {
    return true;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function buildNavigateArgs(url: string | undefined): GuestArgsResult {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, error: "url is required" };
  }
  if (!isAllowedGuestUrl(trimmed)) {
    return { ok: false, error: GUEST_ADDRESS_REFUSAL };
  }
  return { ok: true, args: { url: trimmed } };
}

function buildClickArgs(act: GuestActInput): GuestArgsResult {
  if (typeof act.x !== "number" || typeof act.y !== "number") {
    return { ok: false, error: "The browser pane can only click at x and y positions. Pass x and y." };
  }
  return { ok: true, args: { kind: "click", x: act.x, y: act.y } };
}

function buildActArgs(act: GuestActInput): GuestArgsResult {
  switch (act.kind) {
    case "click":
      return buildClickArgs(act);
    case "type":
      return typeof act.text === "string"
        ? { ok: true, args: { kind: "type", text: act.text } }
        : { ok: false, error: "Typing needs text." };
    case "press":
      return typeof act.key === "string"
        ? { ok: true, args: { kind: "press", key: act.key } }
        : { ok: false, error: "Pressing a key needs a key name." };
    case "scroll":
      return typeof act.dy === "number"
        ? { ok: true, args: { kind: "scroll", dy: act.dy } }
        : { ok: false, error: "Scrolling needs a dy amount." };
    default:
      return {
        ok: false,
        error: `The browser pane can ${GUEST_ACT_KINDS.join(", ")} for now. Use one of those for this step.`,
      };
  }
}

/** Build the operation arguments the guest pane receives, or a plain error to return. */
export function buildGuestArgs(
  op: GuestOp,
  input: { url?: string; act?: GuestActInput },
): GuestArgsResult {
  switch (op) {
    case "navigate":
      return buildNavigateArgs(input.url);
    case "act":
      return buildActArgs(input.act ?? {});
    default:
      return { ok: true, args: {} };
  }
}
