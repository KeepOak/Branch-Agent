// Puts the app icon on the compiled Windows launcher (release-build.mjs). The .NET Framework csc cannot read
// assets/branch.ico (every image in it is PNG-compressed), so the launcher is compiled without one and the icon is
// stamped on here with resedit, the library the packager uses to put the same icon on Branch Agent.exe.
// Build tooling only: never copied into dist, so the app and the update helper keep to Node built-ins.
import { readFile, writeFile } from "node:fs/promises";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

/** Icon group id and language a C# compiler would have used for /win32icon. */
export const WINDOWS_LAUNCHER_ICON_GROUP = 1;
export const WINDOWS_LAUNCHER_ICON_LANG = 1033;

/** The exe bytes with the .ico's images as its icon group (replacing any it had). Pure: bytes in, bytes out. */
export function withWindowsIcon(exeBytes, icoBytes) {
  const exe = NtExecutable.from(exeBytes);
  const resources = NtExecutableResource.from(exe);
  const icons = Data.IconFile.from(icoBytes).icons.map(icon => icon.data);
  if (!icons.length) throw new Error("The launcher icon file has no images");
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, WINDOWS_LAUNCHER_ICON_GROUP, WINDOWS_LAUNCHER_ICON_LANG, icons);
  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

export async function stampWindowsLauncherIcon(exe, icon) {
  await writeFile(exe, withWindowsIcon(await readFile(exe), await readFile(icon)));
}

/** How many icon groups an exe carries (used by tests). */
export function launcherIconGroups(exeBytes) {
  return Resource.IconGroupEntry.fromEntries(NtExecutableResource.from(NtExecutable.from(exeBytes)).entries).length;
}
