#!/usr/bin/env node
// Explicit publication command. Never called by local prepare/test paths.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSeedbankCatalog,
  ghCommandEnv,
  npmPublishEnv,
  resolveSeedbankEntry,
} from "./lib/seedbank-distribution.mjs";

const [directory, mode] = process.argv.slice(2);
if (!directory || !["--verify", "--publish"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/seedbank-publish.mjs <prepared-directory> <--verify|--publish>",
  );
}
const root = resolve(directory);
const catalog = JSON.parse(readFileSync(join(root, "seedbank.json"), "utf8"));
if (!catalog.packages?.length) {
  throw new Error("Refusing empty Seedbank publication.");
}
const packages = catalog.packages.map((entry) => {
  resolveSeedbankEntry(catalog, entry.seedbankSpec);
  // The scan record cannot be re-derived from the tarball, so the stored record is carried forward as-is.
  return {
    filename: entry.filename,
    bytes: readFileSync(join(root, entry.filename)),
    scan: entry.scan ?? undefined,
  };
});
const regenerated = createSeedbankCatalog({
  sourceSha: catalog.sourceSha,
  releaseTag: catalog.releaseTag,
  packages,
});
if (JSON.stringify(regenerated) !== JSON.stringify(catalog)) {
  throw new Error("Catalog differs from its local tarballs.");
}
if (mode === "--verify") {
  console.log(
    JSON.stringify({
      verified: true,
      sourceSha: catalog.sourceSha,
      packages: catalog.packages.map((entry) => entry.npmSpec),
    }),
  );
} else {
  if (
    process.env.GITHUB_REPOSITORY !== "KeepOak/Branch-Agent" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.BRANCH_PLUGIN_PUBLICATION_ENABLED !== "true"
  ) {
    throw new Error(
      "Publication requires the explicitly enabled main-branch workflow in KeepOak/Branch-Agent.",
    );
  }
  if (catalog.sourceSha !== process.env.GITHUB_SHA) {
    throw new Error("Prepared source differs from the approved workflow head.");
  }
  const repository = "KeepOak/Branch-Agent";
  function gh(args) {
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      env: ghCommandEnv(),
      shell: false,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message ?? result.stderr);
    }
    return result.stdout;
  }
  const existing = spawnSync(
    "gh",
    ["api", `repos/${repository}/releases/tags/${catalog.releaseTag}`],
    { encoding: "utf8", env: ghCommandEnv(), shell: false, windowsHide: true },
  );
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout);
    if (release.target_commitish !== catalog.sourceSha || release.draft) {
      throw new Error("Existing release does not bind the approved source.");
    }
  } else {
    if (!existing.stderr?.includes("HTTP 404")) {
      throw new Error(existing.stderr ?? "GitHub release lookup failed.");
    }
    gh([
      "release",
      "create",
      catalog.releaseTag,
      "--repo",
      repository,
      "--target",
      catalog.sourceSha,
      "--title",
      `Seedbank ${catalog.releaseTag}`,
      "--notes",
      `Branch Agent plugins at ${catalog.sourceSha}. Identical npm and backup tarball bytes.`,
      ...packages.map((entry) => join(root, entry.filename)),
      join(root, "seedbank.json"),
      join(root, "index.html"),
    ]);
  }
  const downloaded = mkdtempSync(join(tmpdir(), "seedbank-release-readback-"));
  try {
    gh(["release", "download", catalog.releaseTag, "--repo", repository, "--dir", downloaded]);
    for (const filename of [
      ...packages.map((entry) => entry.filename),
      "seedbank.json",
      "index.html",
    ]) {
      if (!readFileSync(join(root, filename)).equals(readFileSync(join(downloaded, filename)))) {
        throw new Error(`Release readback mismatch: ${filename}`);
      }
    }
  } finally {
    rmSync(downloaded, { recursive: true, force: true });
  }
  async function readRegistry(entry) {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${entry.version}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`npm readback failed: ${response.status}`);
    }
    const metadata = await response.json();
    if (
      metadata.name !== entry.name ||
      metadata.version !== entry.version ||
      metadata.dist?.integrity !== entry.integrity ||
      !metadata.dist?.tarball?.startsWith("https://registry.npmjs.org/")
    ) {
      throw new Error(`npm identity/integrity differs: ${entry.npmSpec}`);
    }
    const tarball = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(120_000) });
    if (!tarball.ok) {
      throw new Error(`npm tarball readback failed: ${tarball.status}`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of tarball.body) {
      size += chunk.length;
      if (size > entry.size) {
        throw new Error("npm tarball readback exceeds approved size.");
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error(`npm tarball bytes differ: ${entry.npmSpec}`);
    }
    return true;
  }
  for (const entry of catalog.packages) {
    if (await readRegistry(entry)) {
      continue;
    }
    const result = spawnSync(
      "npm",
      [
        "publish",
        join(root, entry.filename),
        "--ignore-scripts",
        "--access",
        "public",
        "--provenance",
        "--tag",
        entry.version.includes("-") ? "beta" : "latest",
      ],
      { stdio: "inherit", env: npmPublishEnv(), shell: false, windowsHide: true },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `npm publication failed: ${entry.npmSpec}; the verified GitHub backup remains available.`,
      );
    }
    let verified = false;
    for (let attempt = 0; attempt < 8 && !verified; attempt++) {
      verified = await readRegistry(entry);
      if (!verified) {
        await new Promise((done) => {
          setTimeout(done, 3000);
        });
      }
    }
    if (!verified) {
      throw new Error(`npm publication not visible after readback deadline: ${entry.npmSpec}`);
    }
  }
  console.log(
    JSON.stringify({
      publishedAndReadBack: true,
      releaseTag: catalog.releaseTag,
      sourceSha: catalog.sourceSha,
      packages: catalog.packages.map((entry) => entry.npmSpec),
    }),
  );
}
