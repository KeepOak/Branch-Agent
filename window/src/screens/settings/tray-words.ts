// Where Branch's icon sits by the clock: the menu bar on a Mac, the tray on Windows and Linux. Settings rows that name
// that place (the usage switch, the Appearance card for the icon and its menu) take their words from here, so the R1
// page and the Classic page say the same thing.

/** True on a Mac (the same test as setup's platformName). */
export function onMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
}

/** "menu bar" on a Mac, "tray" elsewhere. */
export const trayPlace = (mac: boolean = onMacPlatform()): string => (mac ? "menu bar" : "tray");

/** The Appearance card for Branch's icon and its menu. */
export const trayCard = (mac: boolean = onMacPlatform()): string => (mac ? "Menu bar" : "Tray");

/** The Appearance row inside that card. */
export const trayMenuLabel = (mac: boolean = onMacPlatform()): string => (mac ? "Menu bar icon" : "Tray menu");
export const trayMenuHelp = (mac: boolean = onMacPlatform()): string => `What Branch puts in the ${trayPlace(mac)}: its icon and menu.`;
export const trayMenuReason = (mac: boolean = onMacPlatform()): string => `What Branch puts in the ${trayPlace(mac)} needs the Branch desktop app.`;

/** The desktop app's trayUsage switch: one line, the same on both Settings pages. */
export const trayUsageLabel = (mac: boolean = onMacPlatform()): string => `Show usage in the ${trayPlace(mac)}`;
export const trayUsageHelp = (mac: boolean = onMacPlatform()): string => `The ring from the bottom bar, also in the ${trayPlace(mac)}.`;
