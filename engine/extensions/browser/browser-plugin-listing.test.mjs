// The browser plugin's manifest and its Seedbank listing. The listing pins the manifest by SHA-256, so any change to
// the manifest must come with a new pin in the same commit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestBytes = readFileSync(join(here, "branch.plugin.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const listing = JSON.parse(readFileSync(join(here, "seedbank-listing.json"), "utf8"));

test("the listing pins the manifest bytes by SHA-256", () => {
  const digest = createHash("sha256").update(manifestBytes).digest("hex");
  assert.equal(listing.manifestSha256, digest);
});

test("the listing names the same plugin and publisher as the manifest", () => {
  assert.equal(listing.id, manifest.id);
  assert.equal(listing.publisher, manifest.publisher);
  assert.equal(listing.publisher, "KeepOak");
  assert.equal(listing.tier, "bundled");
  assert.equal(listing.kind, "plugins");
  assert.equal(listing.manifest, "engine/extensions/browser/branch.plugin.json");
});

test("the permissions are plain sentences and the listing repeats them exactly", () => {
  assert.ok(Array.isArray(manifest.permissions) && manifest.permissions.length > 0);
  assert.deepEqual(listing.permissions, manifest.permissions);
  for (const sentence of manifest.permissions) {
    assert.equal(typeof sentence, "string");
    assert.match(sentence, /^[A-Z][^—–]*\.$/, `plain sentence expected: ${sentence}`);
    assert.ok(sentence.length <= 160, `too long: ${sentence}`);
  }
});

test("the manifest keeps the browser tool and its activation", () => {
  assert.equal(manifest.id, "browser");
  assert.deepEqual(manifest.contracts.tools, ["browser"]);
  assert.equal(manifest.activation.onStartup, true);
});
