// iOS configure signing tests cover generated local signing defaults.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../helpers/temp-dir.js";

const SCRIPT = path.join(process.cwd(), "scripts", "ios-configure-signing.sh");
const TEAM_ID_SCRIPT = path.join(process.cwd(), "scripts", "ios-team-id.sh");
const BASH_BIN = process.platform === "win32" ? "bash" : "/bin/bash";

const tempDirs: string[] = [];
let fixtureScript = "";
let fixtureLocalSigningFile = "";

function bashArgs(scriptPath: string): string[] {
  return process.platform === "win32" ? [scriptPath] : ["--noprofile", "--norc", scriptPath];
}

function runConfigureSigning(teamId: string, user = "localuser"): string {
  return execFileSync(BASH_BIN, bashArgs(fixtureScript), {
    env: {
      ...process.env,
      IOS_DEVELOPMENT_TEAM: teamId,
      BRANCH_IOS_APP_BUNDLE_ID: "",
      BRANCH_IOS_BUNDLE_ID_BASE: "",
      BRANCH_IOS_BUNDLE_SUFFIX: "",
      BRANCH_IOS_APP_GROUP_ID: "",
      BRANCH_IOS_SHARE_BUNDLE_ID: "",
      BRANCH_IOS_ACTIVITY_WIDGET_BUNDLE_ID: "",
      BRANCH_IOS_WATCH_APP_BUNDLE_ID: "",
      USER: user,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readGeneratedSigning(): string {
  return readFileSync(fixtureLocalSigningFile, "utf8");
}

describe("scripts/ios-configure-signing.sh", { concurrent: false }, () => {
  beforeAll(() => {
    const fixtureRoot = makeTempDir(tempDirs, "branch-ios-configure-signing-");
    const scriptsDir = path.join(fixtureRoot, "scripts");
    const iosDir = path.join(fixtureRoot, "apps", "ios");
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(iosDir, { recursive: true });

    fixtureScript = path.join(scriptsDir, "ios-configure-signing.sh");
    fixtureLocalSigningFile = path.join(iosDir, ".local-signing.xcconfig");
    copyFileSync(SCRIPT, fixtureScript);
    copyFileSync(TEAM_ID_SCRIPT, path.join(scriptsDir, "ios-team-id.sh"));
  });

  afterAll(async () => {
    cleanupTempDirs(tempDirs);
  });

  it("uses the canonical app bundle ID for the canonical Branch Agent team", () => {
    const stdout = runConfigureSigning("FWJYW4S8P8");
    const generated = readGeneratedSigning();

    expect(stdout).toContain("team=FWJYW4S8P8 app=ai.branchfoundation.app");
    expect(generated).toContain("BRANCH_DEVELOPMENT_TEAM = FWJYW4S8P8");
    expect(generated).toContain("BRANCH_CODE_SIGN_ENTITLEMENTS = Sources/Branch.entitlements");
    expect(generated).toContain("BRANCH_APP_BUNDLE_ID = ai.branchfoundation.app");
    expect(generated).toContain("BRANCH_SHARE_BUNDLE_ID = ai.branchfoundation.app.share");
    expect(generated).toContain("BRANCH_APP_GROUP_ID = group.ai.branchfoundation.app.shared");
    expect(generated).toContain("BRANCH_ACTIVITY_WIDGET_PROFILE = ");
  });

  it("keeps unique local bundle IDs for non-canonical fallback teams", () => {
    const stdout = runConfigureSigning("Y3YUZP442G");
    const generated = readGeneratedSigning();

    expect(stdout).toContain(
      "canonical_team=FWJYW4S8P8 local_team=Y3YUZP442G app=ai.branchfoundation.app.test.localuser-y3yuzp442g",
    );
    expect(generated).toContain("BRANCH_DEVELOPMENT_TEAM = Y3YUZP442G");
    expect(generated).toContain(
      "BRANCH_APP_BUNDLE_ID = ai.branchfoundation.app.test.localuser-y3yuzp442g",
    );
    expect(generated).toContain(
      "BRANCH_APP_GROUP_ID = group.ai.branchfoundation.app.test.localuser-y3yuzp442g.shared",
    );
  });
});
