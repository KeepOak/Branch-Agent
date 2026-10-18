// Toasts (DESIGN-SPEC §4.10, §5.11): every area calls notify(...). One shows at a time: a new one replaces
// the old, except outcomes that must not be lost (`keep`), which wait their turn. A toast stays 6 s, pauses
// while the pointer or keyboard focus is on it, and its × closes it. It is never the only effect of a control.
import { clearBanner } from "./Banner";
import { onHostnames } from "./plain-address";
import { plainError, plainText } from "./plain-error";
export type ToastAction = { label: string; run: () => void };
export type ToastTone = "plain" | "bad";
export type Toast = { id: number; text: string; line?: string; action?: ToastAction; tone: ToastTone; keep: boolean };
/** `keep`: an outcome that must not be lost waits its turn instead of being replaced (§5.11). */
export type NotifyOptions = { line?: string; action?: ToastAction; tone?: ToastTone; keep?: boolean };

export const TOAST_MS = 6000;

const NOTICES_HERE_KEY = "branch.notices.thisComputer";
/** Whether this computer shows its own OS notices (the Notifications page's switch). Absent means on. */
export function noticesHereOn(): boolean {
  try { return localStorage.getItem(NOTICES_HERE_KEY) !== "off"; } catch { return true; }
}
export function setNoticesHere(on: boolean): void {
  try { localStorage.setItem(NOTICES_HERE_KEY, on ? "on" : "off"); } catch { /* storage blocked: the choice lasts this window */ }
}

const MUTED_KEY = "branch.mutedContacts";
export function readMutedContacts(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}
export function saveMutedContacts(ids: ReadonlySet<string>): void {
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...ids])); } catch { /* storage blocked */ }
}

/** Muting affects alerts, not the contact's unread watermark or row dot. */
export function contactAlert(contact: { name: string; preview: { kind: "message" | "topic"; text: string; title?: string }; needsYou: boolean }, muted: boolean): { title: string; body: string } | null {
  if (muted && !contact.needsYou && !/@[\w-]+/.test(contact.preview.text)) return null;
  return { title: contact.name, body: contact.preview.kind === "topic" ? `in ${contact.preview.title}: ${contact.preview.text}` : contact.preview.text };
}
export function contactAlertTarget(contact: { threadKey: string; preview: { kind: "message" } | { kind: "topic"; topicKey: string } }): string {
  return contact.preview.kind === "topic" ? contact.preview.topicKey : contact.threadKey;
}

/** One desktop notice per waiting item: `{who} is waiting for you`. */
export function waitingNotice(who: string): { title: string; body: string } {
  return { title: who.trim() || "A Trunk", body: "is waiting for you" };
}

/** An OS notice's title and body with no hostname, address or URL at Regular (walkthrough B-026). */
export function osNotice(title: string, body: string): { title: string; body: string } {
  return { title: plainText(title), body: plainText(body) };
}

const waitingNotices = new Map<string, { close: () => void }>();

export function resetWaitingNotices(): void {
  for (const notice of waitingNotices.values()) notice.close();
  waitingNotices.clear();
}

/** Replace or close the OS notice for each waiting item. Never stacks a second copy of the same id. */
export function syncWaitingNotices(
  items: readonly { id: string; who: string }[],
  env: { hidden: boolean; permission?: NotificationPermission; notify?: (title: string, opts: NotificationOptions) => { close: () => void } } = { hidden: typeof document !== "undefined" && document.hidden },
): void {
  const ids = new Set(items.map((item) => item.id));
  for (const [id, notice] of [...waitingNotices]) {
    if (ids.has(id)) continue;
    notice.close();
    waitingNotices.delete(id);
  }
  const permission = env.permission ?? (typeof Notification === "undefined" ? "default" : Notification.permission);
  if (!env.hidden || permission !== "granted" || !noticesHereOn()) return;
  const make = env.notify ?? ((title, opts) => new Notification(title, opts));
  for (const item of items) {
    if (waitingNotices.has(item.id)) continue;
    const notice = waitingNotice(item.who);
    const { title, body } = osNotice(notice.title, notice.body);
    waitingNotices.set(item.id, make(title, { body, tag: item.id }));
  }
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function refilterToasts(): void {
  let changed = false;
  toasts = toasts.map((toast) => {
    const plain = toast.tone === "bad" ? plainError : plainText;
    const text = plain(toast.text);
    const line = toast.line === undefined ? undefined : plain(toast.line);
    if (text === toast.text && line === toast.line) return toast;
    changed = true;
    return { ...toast, text, line };
  });
  if (changed) emit();
}

onHostnames(refilterToasts);

/** Shows a toast and returns its id. `line` is the smaller second line; `action` is its one button (for example Undo). */
export function notify(text: string, options: NotifyOptions = {}): number {
  clearBanner();
  const id = nextId++;
  // No hostname, IP address or URL (walkthrough B-026) and no raw error, code, id or path (Private #1089) at Regular. A
  // "bad" toast is a failure, so its words go through plainError(); any other toast keeps plain words like "Copied.".
  const plain = options.tone === "bad" ? plainError : plainText;
  const toast: Toast = { id, text: plain(text), tone: options.tone ?? "plain", line: options.line === undefined ? undefined : plain(options.line), action: options.action, keep: options.keep === true };
  toasts = [...toasts.filter((t) => t.keep), toast];
  emit();
  return id;
}

export function dismiss(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) {
    emit();
  }
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}
