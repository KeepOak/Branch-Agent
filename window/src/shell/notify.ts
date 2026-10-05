// Toasts (DESIGN-SPEC §4.10, §5.11): every area calls notify(...). One shows at a time: a new one replaces
// the old, except outcomes that must not be lost (`keep`), which wait their turn. A toast stays 6 s, pauses
// while the pointer or keyboard focus is on it, and its × closes it. It is never the only effect of a control.
export type ToastAction = { label: string; run: () => void };
export type ToastTone = "plain" | "bad";
export type Toast = { id: number; text: string; line?: string; action?: ToastAction; tone: ToastTone; keep: boolean };
/** `keep`: an outcome that must not be lost waits its turn instead of being replaced (§5.11). */
export type NotifyOptions = { line?: string; action?: ToastAction; tone?: ToastTone; keep?: boolean };

export const TOAST_MS = 6000;

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

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Shows a toast and returns its id. `line` is the smaller second line; `action` is its one button (for example Undo). */
export function notify(text: string, options: NotifyOptions = {}): number {
  const id = nextId++;
  const toast: Toast = { id, text, tone: options.tone ?? "plain", line: options.line, action: options.action, keep: options.keep === true };
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
