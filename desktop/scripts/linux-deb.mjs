// Debian package for the Linux desktop download. The versioned AppImage stays the file install.sh and the
// in-app updater fetch; this package is what a person installs from the release page. dpkg sets the executable
// bits and the application-menu entry, which a browser download of the AppImage does not.
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const ICON = fileURLToPath(new URL("../assets/brand/linux/branch-512.png", import.meta.url));
const INSTALL_ROOT = "opt/branch-agent";

/** Application menu entry. Exec is the package path, so the launcher's own directory is the install root. */
export const LINUX_DEB_DESKTOP = [
  "[Desktop Entry]",
  "Type=Application",
  "Name=Branch Agent",
  "Exec=/opt/branch-agent/branch-agent %U",
  "Icon=branch-agent",
  "Categories=Utility;",
  "Terminal=false",
  "",
].join("\n");

/** PATH entry. A symlink would leave $0 in /usr/bin and the launcher would miss the package beside it. */
export const LINUX_DEB_LAUNCHER = "#!/bin/sh\nexec /opt/branch-agent/branch-agent \"$@\"\n";

function header(name, size, mode, type = "0", link = "") {
  const originalName = name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    let cut = name.lastIndexOf("/");
    while (cut >= 0 && (Buffer.byteLength(name.slice(0, cut)) > 155 || Buffer.byteLength(name.slice(cut + 1)) > 100)) {
      cut = name.lastIndexOf("/", cut - 1);
    }
    if (cut < 0) throw new Error(`Path exceeds ustar format: ${originalName} (${Buffer.byteLength(originalName)} UTF-8 bytes)`);
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
  }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Path exceeds ustar format: ${originalName} (${Buffer.byteLength(originalName)} UTF-8 bytes)`);
  if (Buffer.byteLength(link) > 100) throw new Error(`Archive link target exceeds ustar format: ${originalName}`);
  const block = Buffer.alloc(512);
  const field = (value, offset, width) => block.write(value, offset, width, "utf8");
  const number = (value, offset, width) => field(value.toString(8).padStart(width - 1, "0") + "\0", offset, width);
  field(name, 0, 100);
  number(mode & 0o7777, 100, 8);
  number(0, 108, 8);
  number(0, 116, 8);
  number(size, 124, 12);
  number(0, 136, 12);
  block.fill(32, 148, 156);
  block[156] = type.charCodeAt(0);
  field(link, 157, 100);
  field("ustar\0", 257, 6);
  field("00", 263, 2);
  field("root", 265, 32);
  field("root", 297, 32);
  field(prefix, 345, 155);
  field(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return block;
}

function packTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    chunks.push(header(entry.name, data.length, entry.mode, entry.type, entry.link ?? ""));
    if (data.length) {
      chunks.push(data);
      const padding = (512 - data.length % 512) % 512;
      if (padding) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function gzip(bytes) {
  const archive = gzipSync(bytes, { mtime: 0 });
  archive[9] = 0xff;
  return archive;
}

/** dpkg-deb writes ar fields left-aligned and space-padded, with no slash after the member name. */
function arMember(name, data) {
  if (name.length > 16) throw new Error(`ar member name too long: ${name}`);
  const block = Buffer.alloc(60, 0x20);
  block.write(name, 0, name.length, "ascii");
  const field = (value, offset, width) => block.write(String(value).padEnd(width, " "), offset, width, "ascii");
  field(0, 16, 12);
  field(0, 28, 6);
  field(0, 34, 6);
  field("100644", 40, 8);
  field(data.length, 48, 10);
  block.write("`\n", 58, 2, "ascii");
  const pad = data.length % 2 === 1 ? Buffer.from("\n") : Buffer.alloc(0);
  return Buffer.concat([block, data, pad]);
}

function packDeb(controlTar, dataTar) {
  return Buffer.concat([
    Buffer.from("!<arch>\n"),
    arMember("debian-binary", Buffer.from("2.0\n")),
    arMember("control.tar.gz", gzip(controlTar)),
    arMember("data.tar.gz", gzip(dataTar)),
  ]);
}

function fileMode(archiveName, info) {
  if (archiveName === `./${INSTALL_ROOT}/chrome-sandbox`) return 0o4755;
  if ([`./${INSTALL_ROOT}/branch-agent`, `./${INSTALL_ROOT}/Branch Agent`, `./${INSTALL_ROOT}/Branch Agent.bin`].includes(archiveName)) return 0o755;
  return (info.mode & 0o111) ? 0o755 : 0o644;
}

function addTree(entries, disk, archiveDir) {
  entries.set(`${archiveDir}/`, { name: `${archiveDir}/`, type: "5", mode: 0o755 });
  for (const name of readdirSync(disk).sort()) {
    const diskPath = join(disk, name);
    const archiveName = `${archiveDir}/${name}`;
    const info = lstatSync(diskPath);
    if (info.isSymbolicLink()) entries.set(archiveName, { name: archiveName, type: "2", mode: 0o777, link: readlinkSync(diskPath) });
    else if (info.isDirectory()) addTree(entries, diskPath, archiveName);
    else if (info.isFile()) entries.set(archiveName, { name: archiveName, type: "0", mode: fileMode(archiveName, info), data: readFileSync(diskPath) });
    else throw new Error(`Cannot pack ${archiveName} into the Linux deb`);
  }
}

function requirePayload(payload, name) {
  try { if (!lstatSync(join(payload, name)).isFile()) throw new Error("not a file"); }
  catch (error) { if (error?.code === "ENOENT" || error.message === "not a file") throw new Error(`The Linux package has no ${name} at its root`); throw error; }
}

/** Debian control Version. Release versions already match this; anything else is refused. */
export function debVersion(version) {
  if (!/^[0-9][A-Za-z0-9.+~-]*$/.test(version)) throw new Error(`Not a Debian package version: ${version}`);
  return version;
}

/**
 * Writes Branch-Linux.deb: the desktop package under /opt/branch-agent, a PATH launcher, the icon and a menu entry.
 * chrome-sandbox is mode 4755 so Chromium's sandbox is available after dpkg installs the package as root.
 */
export function buildLinuxDeb({ payload, version, out, icon = ICON }) {
  requirePayload(payload, "Branch Agent.bin");
  requirePayload(payload, "chrome-sandbox");
  requirePayload(payload, "branch-agent");
  const iconBytes = readFileSync(icon);
  const entries = new Map();
  entries.set("./", { name: "./", type: "5", mode: 0o755 });
  entries.set("./opt/", { name: "./opt/", type: "5", mode: 0o755 });
  addTree(entries, payload, `./${INSTALL_ROOT}`);
  for (const dir of ["./usr/", "./usr/bin/", "./usr/share/", "./usr/share/applications/", "./usr/share/icons/", "./usr/share/icons/hicolor/", "./usr/share/icons/hicolor/512x512/", "./usr/share/icons/hicolor/512x512/apps/"]) {
    entries.set(dir, { name: dir, type: "5", mode: 0o755 });
  }
  const desktop = Buffer.from(LINUX_DEB_DESKTOP);
  const launcher = Buffer.from(LINUX_DEB_LAUNCHER);
  entries.set("./usr/bin/branch-agent", { name: "./usr/bin/branch-agent", type: "0", mode: 0o755, data: launcher });
  entries.set("./usr/share/applications/branch-agent.desktop", { name: "./usr/share/applications/branch-agent.desktop", type: "0", mode: 0o644, data: desktop });
  entries.set("./usr/share/icons/hicolor/512x512/apps/branch-agent.png", { name: "./usr/share/icons/hicolor/512x512/apps/branch-agent.png", type: "0", mode: 0o644, data: iconBytes });
  const files = [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const installed = files.reduce((sum, entry) => sum + (entry.data?.length ?? entry.link?.length ?? 0), 0);
  const control = [
    "Package: branch-agent",
    `Version: ${debVersion(version)}`,
    "Section: utils",
    "Priority: optional",
    "Architecture: amd64",
    "Maintainer: Branch Agent <noreply@keepoak.com>",
    `Installed-Size: ${Math.max(1, Math.ceil(installed / 1024))}`,
    "Homepage: https://github.com/KeepOak/Branch-Agent",
    "Description: Branch Agent desktop app",
    " Starts the Branch engine and opens the Branch window.",
    "",
  ].join("\n");
  const controlTar = packTar([{ name: "./control", type: "0", mode: 0o644, data: Buffer.from(control) }]);
  const bytes = packDeb(controlTar, packTar(files));
  writeFileSync(out, bytes);
  return out;
}

function readTar(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (block.every(byte => byte === 0)) break;
    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const full = prefix ? `${prefix}/${name}` : name;
    const mode = parseInt(block.subarray(100, 108).toString("utf8").replace(/\0.*$/, "").trim(), 8);
    const size = parseInt(block.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(block[156]);
    const link = block.subarray(157, 257).toString("utf8").replace(/\0.*$/, "");
    const data = bytes.subarray(offset, offset + size);
    offset += size + (512 - size % 512) % 512;
    entries.push({ name: full, mode, type, link, data: Buffer.from(data) });
  }
  return entries;
}

function readAr(bytes) {
  if (bytes.subarray(0, 8).toString("ascii") !== "!<arch>\n") throw new Error("Not a Debian package");
  const members = [];
  let offset = 8;
  while (offset + 60 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 60);
    offset += 60;
    if (block.subarray(58, 60).toString("ascii") !== "`\n") throw new Error("Broken ar header");
    const name = block.subarray(0, 16).toString("ascii").trim();
    const size = Number(block.subarray(48, 58).toString("ascii").trim());
    members.push({ name, data: Buffer.from(bytes.subarray(offset, offset + size)) });
    offset += size + (size % 2);
  }
  return members;
}

/** Reads a deb this module wrote: control text and data-archive entries. */
export function readLinuxDeb(bytes) {
  const members = Object.fromEntries(readAr(bytes).map(member => [member.name, member.data]));
  if (!members["debian-binary"] || !members["control.tar.gz"] || !members["data.tar.gz"]) throw new Error("Debian package is missing a member");
  const control = readTar(gunzipSync(members["control.tar.gz"])).find(entry => entry.name === "./control" || entry.name === "control");
  if (!control) throw new Error("Debian package has no control file");
  return { control: control.data.toString("utf8"), files: readTar(gunzipSync(members["data.tar.gz"])) };
}
