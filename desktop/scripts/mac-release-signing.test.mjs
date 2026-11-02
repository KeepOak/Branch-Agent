import assert from "node:assert/strict";
import test from "node:test";
import { MAC_ADHOC_NOTICE, MAC_SIGNING_SETTINGS, macSignCommand, macSigningPlan } from "./mac-release-signing.mjs";

const identity = { BRANCH_MACOS_SIGNING_P12_FILE: "/run/signing.p12", BRANCH_MACOS_SIGNING_PASSWORD_FILE: "/run/signing-password", BRANCH_MACOS_RCODESIGN: "/run/rcodesign" };
const app = "/build/Branch Agent.app";

test("all three settings keep today's rcodesign identity signing", () => {
  const plan = macSigningPlan(identity);
  assert.equal(plan.signing, "identity");
  assert.deepEqual(macSignCommand(plan, app), ["/run/rcodesign", ["sign", "--p12-file", "/run/signing.p12", "--p12-password-file", "/run/signing-password", app]]);
});

test("no signing settings sign the finished bundle ad-hoc with codesign", () => {
  const plan = macSigningPlan({ PATH: "/usr/bin" });
  assert.deepEqual(plan, { signing: "adhoc" });
  assert.deepEqual(macSignCommand(plan, app), ["codesign", ["--force", "--deep", "--sign", "-", app]]);
  assert.deepEqual(macSigningPlan({ BRANCH_MACOS_SIGNING_P12_FILE: "", BRANCH_MACOS_SIGNING_PASSWORD_FILE: "", BRANCH_MACOS_RCODESIGN: "" }), { signing: "adhoc" });
  assert.equal(MAC_ADHOC_NOTICE, "macOS signing: no signing identity configured. Building ad-hoc signed; Gatekeeper will warn on a downloaded copy, script installs are unaffected.");
});

test("a partial signing identity fails and names what is missing, never falling back to ad-hoc", () => {
  for (const name of MAC_SIGNING_SETTINGS) {
    const partial = { ...identity, [name]: "" };
    assert.throws(() => macSigningPlan(partial), new RegExp(`incomplete: ${name} is not set`));
  }
  assert.throws(() => macSigningPlan({ BRANCH_MACOS_RCODESIGN: "/run/rcodesign" }),
    /incomplete: BRANCH_MACOS_SIGNING_P12_FILE, BRANCH_MACOS_SIGNING_PASSWORD_FILE are not set/);
});

test("darwin-x64 is always ad-hoc and never uses the pinned release identity", () => {
  assert.deepEqual(macSigningPlan(identity, { arch: "x64" }), { signing: "adhoc" });
  assert.deepEqual(macSignCommand(macSigningPlan(identity, { arch: "x64" }), app), ["codesign", ["--force", "--deep", "--sign", "-", app]]);
});

test("an unknown plan never produces a signing command", () => {
  assert.throws(() => macSignCommand({ signing: "none" }, app), /Unknown macOS signing plan/);
  assert.throws(() => macSignCommand(undefined, app), /Unknown macOS signing plan/);
});
