// The computer's own permissions for Settings › Permissions › This computer: what macOS or Windows already allows,
// a single Allow that shows the system's own prompt where one exists, and the matching System Settings page.
// Electron can read and ask for the microphone and camera (systemPreferences). It has no way to read location or
// notification permission, so those say "unknown" and open their settings page instead of guessing.
// Every OS call is injected, so the tests use fakes and never prompt or change this computer's privacy settings.
import { isOwnedComponentWindow } from "./component-update-ipc";

export const OS_PERMISSIONS = ["microphone", "camera", "location", "notifications"] as const;
export type OsPermission = (typeof OS_PERMISSIONS)[number];
/** allowed: the system said yes. denied: no (or restricted by policy). not-asked: the system never asked. unknown: no way to read it here. */
export type OsPermissionStatus = "allowed" | "denied" | "not-asked" | "unknown";
export type OsPermissionsState = Record<OsPermission, OsPermissionStatus>;

export interface OsPermissionDeps {
  platform: NodeJS.Platform;
  /** Electron's systemPreferences.getMediaAccessStatus (macOS and Windows). */
  mediaStatus(kind: "microphone" | "camera"): string;
  /** Electron's systemPreferences.askForMediaAccess (macOS only): shows the system prompt the first time. */
  askMedia(kind: "microphone" | "camera"): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

export interface OsPermissions {
  get(): OsPermissionsState;
  /** Shows the system prompt when the system has not asked yet; otherwise changes nothing. Returns the new state. */
  request(name: OsPermission): Promise<OsPermissionsState>;
  /** Opens the system settings page for this permission. */
  open(name: OsPermission): Promise<void>;
}

export const isOsPermission = (name: unknown): name is OsPermission => typeof name === "string" && (OS_PERMISSIONS as readonly string[]).includes(name);
const isMedia = (name: OsPermission): name is "microphone" | "camera" => name === "microphone" || name === "camera";

/** Electron's media access answer in the words the window shows. */
export function mediaStatus(raw: string): OsPermissionStatus {
  if (raw === "granted") return "allowed";
  if (raw === "denied" || raw === "restricted") return "denied";
  if (raw === "not-determined") return "not-asked";
  return "unknown";
}

const MAC_PANE = "x-apple.systempreferences:com.apple.preference.security?";
/** The settings page for each permission, or none where the platform has no single settings app (Linux). */
export function settingsUrl(platform: NodeJS.Platform, name: OsPermission): string | null {
  if (platform === "darwin") {
    return {
      microphone: `${MAC_PANE}Privacy_Microphone`,
      camera: `${MAC_PANE}Privacy_Camera`,
      location: `${MAC_PANE}Privacy_LocationServices`,
      notifications: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    }[name];
  }
  if (platform === "win32") {
    return { microphone: "ms-settings:privacy-microphone", camera: "ms-settings:privacy-webcam", location: "ms-settings:privacy-location", notifications: "ms-settings:notifications" }[name];
  }
  return null;
}

export function createOsPermissions(deps: OsPermissionDeps): OsPermissions {
  const read = (name: OsPermission): OsPermissionStatus => {
    if (!isMedia(name) || (deps.platform !== "darwin" && deps.platform !== "win32")) return "unknown";
    try { return mediaStatus(deps.mediaStatus(name)); } catch { return "unknown"; }
  };
  const get = (): OsPermissionsState => Object.fromEntries(OS_PERMISSIONS.map((n) => [n, read(n)])) as OsPermissionsState;
  return {
    get,
    request: async (name) => {
      // Only macOS shows a prompt from an app, and only the first time; a no stays a no until System Settings changes it.
      if (isMedia(name) && deps.platform === "darwin" && read(name) === "not-asked") await deps.askMedia(name);
      return get();
    },
    open: async (name) => {
      const url = settingsUrl(deps.platform, name);
      if (!url) throw new Error("This computer has no settings page for that permission");
      await deps.openExternal(url);
    },
  };
}

type InvokeEvent = Parameters<typeof isOwnedComponentWindow>[0];
type Sender = Parameters<typeof isOwnedComponentWindow>[1];
interface Ipc { handle(channel: string, listener: (event: InvokeEvent, ...args: unknown[]) => unknown): void }

export function registerOsPermissionsIpc(ipc: Ipc, owner: (event: InvokeEvent) => Sender | undefined, servedUrl: string, permissions: OsPermissions): void {
  const owned = (event: InvokeEvent): void => {
    if (!isOwnedComponentWindow(event, owner(event), servedUrl)) throw new Error("This computer's permissions require the owned served window");
  };
  const named = (name: unknown): OsPermission => {
    if (!isOsPermission(name)) throw new Error("A permission is microphone, camera, location or notifications");
    return name;
  };
  ipc.handle("branch-desktop:permissions:get", async (event) => { owned(event); return permissions.get(); });
  ipc.handle("branch-desktop:permissions:request", async (event, name) => { owned(event); return permissions.request(named(name)); });
  ipc.handle("branch-desktop:permissions:open", async (event, name) => { owned(event); await permissions.open(named(name)); });
}
