// One status for each coding app on this computer (Claude Code, Codex, Gemini CLI). Settings › Accounts, Settings ›
// Coding, Settings › Models and the first-run Your models step all read it, so they say the same plain thing: what
// branch.setup.detect found, then whether models.list gives chats the app's models.
import { list, text, visible, type RecordValue } from "../adapter";
import { appChatModels, type Model } from "./models-data";

export type App = { kind: string; brand: string; name: string; plugin?: string };
export const APPS: App[] = [
  { kind: "claude-cli", brand: "anthropic", name: "Claude Code" },
  { kind: "codex-cli", brand: "openai", name: "Codex", plugin: "codex" },
  { kind: "gemini-cli", brand: "google", name: "Gemini CLI" },
];
export type Found = { state: "ready" | "signin" | "missing"; reason?: string };

export function foundState(app: App, detect: RecordValue | undefined): Found {
  const hit = list(detect?.candidates).find((c) => c.kind === app.kind);
  if (hit) return { state: hit.credentials === false ? "signin" : "ready" };
  const gone = list(detect?.unavailableCandidates).find((c) => text(c.id).includes(app.kind) || text(c.id).includes(app.kind.replace("-cli", "")));
  return { state: "missing", reason: gone ? visible(gone.reason) : undefined };
}

export const PILL: Record<Found["state"], [string, string]> = { ready: ["ok", "Models ready"], signin: ["warn", "Sign-in needed"], missing: ["idle", "Not found"] };

/** The engine's model runtime for a coding app whose sign-in can answer chats; Codex is a plugin with its own switch. */
export const CHAT_RUNTIME: Readonly<Record<string, string>> = { "claude-cli": "claude-cli", "gemini-cli": "google-gemini-cli" };

/** A coding app's one status. "connected": found and signed in, but models.list gives chats none of its models. */
export type AppStatus = { state: Found["state"] | "connected"; reason?: string };

/** The one status Accounts, Settings › Coding, Models and the first-run Your models step all show for a coding app:
 *  what branch.setup.detect found, then whether models.list lists its models for chats. Models still unread (undefined)
 *  leaves the found state as it is. */
export function appStatusOf(app: App, f: Found, models: Model[] | undefined): AppStatus {
  const runtime = CHAT_RUNTIME[app.kind];
  if (f.state !== "ready" || !runtime || models === undefined) return f;
  return appChatModels(models, runtime).length ? f : { state: "connected" };
}
export const appStatus = (app: App, detect: RecordValue | undefined, models: Model[] | undefined): AppStatus => appStatusOf(app, foundState(app, detect), models);

export const STATUS_PILL: Record<AppStatus["state"], [string, string]> = { ...PILL, connected: ["ok", "Connected"] };

/** The status line for a coding app, the same words in every place that shows it. */
export function appStatusLine(app: App, s: AppStatus, on: boolean): string {
  if (s.state === "connected") return notForChats(app);
  return appSub(app, { state: s.state, reason: s.reason }, on);
}
/** A found connection's line on the first-run Your models step. A coding app that can answer chats reads its one
 *  status there too, instead of the engine's own install note; any other connection keeps the engine's words. */
export function foundLine(c: { kind: string; detail: string; signedOut: boolean }, models: Model[] | undefined): string {
  const app = APPS.find((a) => a.kind === c.kind);
  if (!app || !CHAT_RUNTIME[app.kind]) return c.signedOut ? `${c.detail} · signed out` : c.detail;
  return appStatusLine(app, appStatusOf(app, { state: c.signedOut ? "signin" : "ready" }, models), true);
}
export const notForChats = (app: App): string => `${app.name} is connected on this computer, but it isn’t set up as a model for chats yet.`;

export function appSub(app: App, f: Found, on: boolean): string {
  // §4.7.8: an app that isn't installed always reads the same; Codex turns fail with this sentence too.
  if (f.state === "missing") return `Install and sign in to ${app.name} on this computer, then check again.`;
  if (f.state === "signin") return `Open ${app.name} and check its sign-in, then check again.`;
  return on ? `On because ${app.name} is connected on this computer.` : `${app.name} is connected on this computer. Turn it on to use its models.`;
}
