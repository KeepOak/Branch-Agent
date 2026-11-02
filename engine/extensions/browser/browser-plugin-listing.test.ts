// The browser plugin's manifest and its Seedbank listing. The listing pins the manifest by SHA-256, so any change to
// the manifest must come with a new pin in the same commit.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestBytes = readFileSync(path.join(here, "branch.plugin.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  id: string;
  publisher?: string;
  permissions?: string[];
  contracts: { tools: string[] };
  activation: { onStartup: boolean };
};
const listing = JSON.parse(readFileSync(path.join(here, "seedbank-listing.json"), "utf8")) as {
  id: string;
  name: string;
  kind: string;
  tier: string;
  publisher: string;
  badge: string;
  manifest: string;
  manifestSha256: string;
  permissions: string[];
};

describe("browser plugin Seedbank listing", () => {
  it("pins the manifest bytes by SHA-256", () => {
    const digest = createHash("sha256").update(manifestBytes).digest("hex");
    expect(listing.manifestSha256).toBe(digest);
  });

  it("names the same plugin and publisher as the manifest", () => {
    expect(listing.id).toBe(manifest.id);
    expect(listing.publisher).toBe(manifest.publisher);
    expect(listing.publisher).toBe("KeepOak");
    expect(listing.tier).toBe("bundled");
    expect(listing.badge).toBe("Official");
    expect(listing.kind).toBe("plugins");
    expect(listing.manifest).toBe("engine/extensions/browser/branch.plugin.json");
  });

  it("states its permissions as plain sentences, and the listing repeats them exactly", () => {
    const permissions = manifest.permissions ?? [];
    expect(permissions.length).toBeGreaterThan(0);
    expect(listing.permissions).toEqual(permissions);
    for (const sentence of permissions) {
      expect(sentence).toMatch(/^[A-Z][^—–]*\.$/);
      expect(sentence.length).toBeLessThanOrEqual(160);
    }
  });

  it("keeps the browser tool and its startup activation", () => {
    expect(manifest.id).toBe("browser");
    expect(manifest.contracts.tools).toEqual(["browser"]);
    expect(manifest.activation.onStartup).toBe(true);
  });
});
