// How a macOS release build signs its code: the pinned release identity through rcodesign when all three
// signing settings are present, ad-hoc (codesign --sign -) when none are. A partial set is an error, never a fallback.
// The release proof records which one was used as `signing: "identity" | "adhoc"`.

/** The settings that together name the pinned release identity. */
export const MAC_SIGNING_SETTINGS = ["BRANCH_MACOS_SIGNING_P12_FILE", "BRANCH_MACOS_SIGNING_PASSWORD_FILE", "BRANCH_MACOS_RCODESIGN"];
export const MAC_SIGNING_KINDS = ["identity", "adhoc"];
export const MAC_ADHOC_NOTICE = "macOS signing: no signing identity configured. Building ad-hoc signed; Gatekeeper will warn on a downloaded copy, script installs are unaffected.";

/** Reads the signing settings. Throws, naming what is missing, when only some are set. */
export function macSigningPlan(env = process.env) {
  const missing = MAC_SIGNING_SETTINGS.filter(name => !env[name]);
  if (missing.length === 0) {
    return { signing: "identity", p12: env.BRANCH_MACOS_SIGNING_P12_FILE, password: env.BRANCH_MACOS_SIGNING_PASSWORD_FILE, rcodesign: env.BRANCH_MACOS_RCODESIGN };
  }
  if (missing.length === MAC_SIGNING_SETTINGS.length) return { signing: "adhoc" };
  throw new Error(`macOS signing identity is incomplete: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. Set all of ${MAC_SIGNING_SETTINGS.join(", ")} to sign with the release identity, or none of them to build ad-hoc signed.`);
}

/** The command and argv that sign `target` (a bundle or a single binary) under `plan`. */
export function macSignCommand(plan, target) {
  if (plan?.signing === "identity") return [plan.rcodesign, ["sign", "--p12-file", plan.p12, "--p12-password-file", plan.password, target]];
  if (plan?.signing === "adhoc") return ["codesign", ["--force", "--deep", "--sign", "-", target]];
  throw new Error(`Unknown macOS signing plan: ${plan?.signing}`);
}
