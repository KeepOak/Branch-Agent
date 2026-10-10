#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveCommandShim,
  resolveSeedbankEntry,
  seedbankInstallArgs,
  stageSeedbankSkill,
  verifySeedbankPackage,
} from "./lib/seedbank-distribution.mjs";

// This adapter deliberately delegates to the ordinary Branch Agent installers (plugins or skills).
// Capability consent, install-policy checks, and provenance acknowledgement remain enabled.
const [catalogPath, spec, ...options] = process.argv.slice(2);
if (!catalogPath || !spec) {
  throw new Error(
    "Usage: node scripts/seedbank-install.mjs <catalog.json> seedbank:@branch-agent/<package>[@version] [--verify-archive <file> | ordinary Branch Agent install flags]",
  );
}
const entry = resolveSeedbankEntry(JSON.parse(readFileSync(catalogPath, "utf8")), spec);
const verifyOnly = options[0] === "--verify-archive";
if (verifyOnly && options.length !== 2) {
  throw new Error("--verify-archive takes exactly one archive path; nothing was downloaded.");
}
const bytes = verifyOnly ? readFileSync(options[1]) : await downloadEntry(entry);
verifySeedbankPackage(entry, bytes);
if (verifyOnly) {
  console.log(`Verified ${entry.npmSpec} (${entry.sha256})`);
} else {
  installWithBranch(entry, bytes, options);
}

async function downloadEntry(entry) {
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
  return Buffer.concat(chunks);
}

function installWithBranch(entry, bytes, options) {
  const directory = mkdtempSync(join(tmpdir(), "branch-seedbank-"));
  try {
    const location =
      entry.kind === "skill"
        ? stageSeedbankSkill({ bytes, entry, parentDir: directory })
        : writeArchive(join(directory, entry.filename), bytes);
    const args = seedbankInstallArgs({ entry, location, options });
    const invocation = resolveCommandShim("branch", args);
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

function writeArchive(path, bytes) {
  writeFileSync(path, bytes, { mode: 0o600 });
  return path;
}
