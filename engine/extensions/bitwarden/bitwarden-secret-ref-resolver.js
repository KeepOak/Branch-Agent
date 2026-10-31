#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { text as consumeText } from "node:stream/consumers";
import { tryReadSecretFileSync } from "@openclaw/fs-safe/secret";
import { parseBitwardenSecretId } from "./bitwarden-secret-id.js";

const BW_TIMEOUT_MS = 15_000;
const MAX_SECRET_REFS_PER_REQUEST = 32;
const MAX_BW_OUTPUT_BYTES = 1024 * 1024;
const MAX_SESSION_FILE_BYTES = 16 * 1024;

class BitwardenResolverError extends Error {}

function writeResponse(response) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function parseRequest(input) {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ids)) {
    throw new Error("invalid exec SecretRef request");
  }
  return {
    protocolVersion: 1,
    ids: parsed.ids.filter((id) => typeof id === "string" && id.length > 0),
  };
}

function resolveOsHome() {
  const home =
    process.platform === "win32"
      ? process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || os.homedir()
      : process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || os.homedir();
  if (!home) {
    throw new BitwardenResolverError("Unable to resolve the user home for the Bitwarden CLI.");
  }
  return path.resolve(home);
}

function expandHome(value, home) {
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(value.replace(/^~(?=$|[\\/])/u, () => home()));
  }
  return path.resolve(value);
}

function resolveBranchHome() {
  const explicit = process.env.BRANCH_HOME?.trim();
  return explicit ? expandHome(explicit, resolveOsHome) : resolveOsHome();
}

// Keep this static resolver aligned with the root CLI state-dir contract without importing core.
function resolveStateDir() {
  const override = process.env.BRANCH_STATE_DIR?.trim();
  if (override) {
    return expandHome(override, resolveBranchHome);
  }
  const home = resolveBranchHome();
  const profile = process.env.BRANCH_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    if (!/^[A-Za-z0-9_-]+$/u.test(profile)) {
      throw new BitwardenResolverError("invalid Branch Agent profile name");
    }
    return path.join(home, ".branch-" + profile);
  }
  return path.join(home, ".branch");
}

function resolveSessionFilePath() {
  return path.join(resolveStateDir(), "credentials", "bitwarden", "session");
}

function isExecutableFile(candidate) {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function resolveBwCommand() {
  const configured = process.env.BRANCH_BITWARDEN_BW?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new BitwardenResolverError(
        "BRANCH_BITWARDEN_BW must be an absolute path: " + configured,
      );
    }
    if (!isExecutableFile(configured)) {
      throw new BitwardenResolverError(
        "Bitwarden CLI at BRANCH_BITWARDEN_BW is missing or not executable.",
      );
    }
    return configured;
  }
  const executable = process.platform === "win32" ? "bw.exe" : "bw";
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) {
      continue;
    }
    const candidate = path.join(directory, executable);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  throw new BitwardenResolverError(
    "Bitwarden CLI (bw) was not found. Install the official Bitwarden CLI or set BRANCH_BITWARDEN_BW to its absolute path.",
  );
}

function readSession() {
  let session;
  try {
    session = tryReadSecretFileSync(resolveSessionFilePath(), "Bitwarden session", {
      maxBytes: MAX_SESSION_FILE_BYTES,
      rejectHardlinks: false,
      rejectSymlink: true,
    });
  } catch {
    throw new BitwardenResolverError(
      "The Bitwarden session file is unsafe or too large. Save it again with branch bitwarden status for its location.",
    );
  }
  session = session?.trim() || process.env.BW_SESSION?.trim();
  if (!session) {
    throw new BitwardenResolverError(
      'The Bitwarden vault is locked for Branch Agent. Run "bw unlock --raw" and save the session key to the file shown by branch bitwarden status.',
    );
  }
  return session;
}

function bwEnvironment(session) {
  const env = {
    HOME: resolveOsHome(),
    BW_SESSION: session,
    BW_NOINTERACTION: "true",
  };
  for (const name of [
    "PATH",
    "BITWARDENCLI_APPDATA_DIR",
    "NODE_EXTRA_CA_CERTS",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "WINDIR",
  ]) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }
  return env;
}

function classifyBwFailure(stderr) {
  const text = String(stderr ?? "").toLowerCase();
  if (text.includes("vault is locked") || text.includes("you are not logged in")) {
    return "the Bitwarden vault is locked or logged out; unlock it and save a fresh session key.";
  }
  if (text.includes("more than one result")) {
    return "more than one Bitwarden item matches; use the item id instead of its name.";
  }
  if (text.includes("not found")) {
    return "the Bitwarden item was not found.";
  }
  return undefined;
}

function runBw(bwCommand, session, args) {
  return new Promise((resolve, reject) => {
    execFile(
      bwCommand,
      [...args, "--nointeraction"],
      {
        env: bwEnvironment(session),
        encoding: "utf8",
        maxBuffer: MAX_BW_OUTPUT_BYTES,
        timeout: BW_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if (error.code === "ENOENT") {
          reject(new BitwardenResolverError("Bitwarden CLI could not be started."));
          return;
        }
        if (error.killed || error.signal) {
          reject(new BitwardenResolverError("bw timed out after " + BW_TIMEOUT_MS + "ms."));
          return;
        }
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(new BitwardenResolverError("bw output exceeded the resolver limit."));
          return;
        }
        reject(
          new BitwardenResolverError(
            "bw " +
              args[0] +
              " " +
              args[1] +
              " failed: " +
              (classifyBwFailure(stderr) ?? "exit code " + String(error.code) + "."),
          ),
        );
      },
    );
  });
}

function nonEmpty(value, missing) {
  if (typeof value !== "string" || value.length === 0) {
    throw new BitwardenResolverError(missing);
  }
  return value;
}

async function readField(bwCommand, session, item, field) {
  if (field.kind === "custom") {
    const match = Array.isArray(item.fields)
      ? item.fields.find((entry) => entry && entry.name === field.name)
      : undefined;
    return nonEmpty(match?.value, 'the Bitwarden item has no custom field "' + field.name + '".');
  }
  switch (field.name) {
    case "username":
      return nonEmpty(item.login?.username, "the Bitwarden item has no username.");
    case "password":
      return nonEmpty(item.login?.password, "the Bitwarden item has no password.");
    case "notes":
      return nonEmpty(item.notes, "the Bitwarden item has no notes.");
    case "uri":
      return nonEmpty(item.login?.uris?.[0]?.uri, "the Bitwarden item has no website.");
    case "totp": {
      nonEmpty(item.login?.totp, "the Bitwarden item has no verification code.");
      const code = (await runBw(bwCommand, session, ["get", "totp", item.id])).trim();
      return nonEmpty(code, "bw returned an empty verification code.");
    }
    default:
      throw new BitwardenResolverError("unsupported Bitwarden field.");
  }
}

async function fetchItem(bwCommand, session, itemRef) {
  const stdout = await runBw(bwCommand, session, ["get", "item", itemRef]);
  let item;
  try {
    item = JSON.parse(stdout);
  } catch {
    throw new BitwardenResolverError("bw returned an unreadable item.");
  }
  if (!item || typeof item !== "object" || typeof item.id !== "string") {
    throw new BitwardenResolverError("bw returned an unreadable item.");
  }
  return item;
}

function errorMessage(error) {
  return error instanceof BitwardenResolverError || error instanceof Error
    ? error.message
    : "Bitwarden request failed.";
}

async function resolveFromBitwarden(ids) {
  const response = { protocolVersion: 1, values: {}, errors: {} };
  const failAll = (message) => {
    for (const id of ids) {
      response.errors[id] = { message };
    }
    return response;
  };
  if (ids.length > MAX_SECRET_REFS_PER_REQUEST) {
    return failAll(
      "Bitwarden SecretRef resolver supports at most " +
        MAX_SECRET_REFS_PER_REQUEST +
        " references per request.",
    );
  }
  const byItem = new Map();
  for (const id of ids) {
    try {
      const parsed = parseBitwardenSecretId(id);
      const group = byItem.get(parsed.item) ?? [];
      group.push({ id, field: parsed.field });
      byItem.set(parsed.item, group);
    } catch (error) {
      response.errors[id] = { message: errorMessage(error) };
    }
  }
  if (byItem.size === 0) {
    return response;
  }
  let bwCommand;
  let session;
  try {
    bwCommand = resolveBwCommand();
    session = readSession();
  } catch (error) {
    for (const group of byItem.values()) {
      for (const entry of group) {
        response.errors[entry.id] = { message: errorMessage(error) };
      }
    }
    return response;
  }
  // bw keeps one local data file; read items one at a time and each item once.
  for (const [itemRef, group] of byItem) {
    let item;
    try {
      item = await fetchItem(bwCommand, session, itemRef);
    } catch (error) {
      for (const entry of group) {
        response.errors[entry.id] = { message: errorMessage(error) };
      }
      continue;
    }
    for (const entry of group) {
      try {
        response.values[entry.id] = await readField(bwCommand, session, item, entry.field);
      } catch (error) {
        response.errors[entry.id] = { message: errorMessage(error) };
      }
    }
  }
  return response;
}

async function main() {
  const input = await consumeText(process.stdin.setEncoding("utf8"));
  const request = parseRequest(input);
  writeResponse(await resolveFromBitwarden(request.ids));
}

main().catch(() => {
  process.stderr.write("Bitwarden SecretRef resolver failed.\n");
  process.exitCode = 1;
});
