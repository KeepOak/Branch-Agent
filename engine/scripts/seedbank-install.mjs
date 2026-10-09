#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommandShim, resolveSeedbankEntry } from "./lib/seedbank-distribution.mjs";
import { inspectPackageTarballBytes } from "./plugin-publication-artifact.mjs";

// This adapter deliberately delegates to the ordinary Branch Agent archive installer.
// Capability consent, install-policy checks, and provenance acknowledgement remain enabled.
const [catalogPath, spec, ...options] = process.argv.slice(2);
if (!catalogPath || !spec) {
  throw new Error(
    "Usage: node scripts/seedbank-install.mjs <catalog.json> seedbank:@branch-agent/<package>[@version] [--verify-archive <file> | ordinary Branch Agent install flags]",
  );
}
const entry = resolveSeedbankEntry(JSON.parse(readFileSync(catalogPath, "utf8")), spec);
let bytes;
if (options[0] === "--verify-archive" && options.length === 2) {
  bytes = readFileSync(options[1]);
} else {
  const response = await fetch(entry.tarball, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Seedbank download failed: ${response.status}`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > entry.size) {
      throw new Error("Seedbank download exceeds catalog size.");
    }
    chunks.push(chunk);
  }
  bytes = Buffer.concat(chunks);
}
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const inspected = inspectPackageTarballBytes(bytes);
if (
  bytes.length !== entry.size ||
  integrity !== entry.integrity ||
  inspected.tarballSha256 !== entry.sha256 ||
  inspected.packageManifest.name !== entry.name ||
  inspected.packageManifest.version !== entry.version ||
  inspected.pluginManifest.id !== entry.pluginId
) {
  throw new Error("Seedbank package integrity or identity mismatch; installation refused.");
}
if (options[0] === "--verify-archive") {
  console.log(`Verified ${entry.npmSpec} (${entry.sha256})`);
} else {
  const directory = mkdtempSync(join(tmpdir(), "branch-seedbank-"));
  try {
    const archive = join(directory, entry.filename);
    writeFileSync(archive, bytes, { mode: 0o600 });
    const invocation = resolveCommandShim("branch", ["plugins", "install", archive, ...options]);
    const result = spawnSync(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
