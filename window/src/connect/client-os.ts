// The OS this window runs on (Private #1102, B-053): text about this computer names Windows-only parts (WSL) only on
// Windows. Electron and browsers report it in navigator.platform ("Win32", "MacIntel", "Linux x86_64").
export type ClientOs = "windows" | "mac" | "linux" | "other";

export function clientOs(platform: string = typeof navigator === "undefined" ? "" : navigator.platform || ""): ClientOs {
  if (/^win/i.test(platform)) return "windows";
  if (/mac|iphone|ipad/i.test(platform)) return "mac";
  if (/linux|x11|cros|android/i.test(platform)) return "linux";
  return "other";
}
