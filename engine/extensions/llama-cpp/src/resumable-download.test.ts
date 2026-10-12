// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-local-inference/src/services/downloader.test.ts (atlas MODELS-ACCOUNTS-0141)
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithSsrFGuard: vi.fn() }));

vi.mock("branch/plugin-sdk/ssrf-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/ssrf-runtime")>()),
  fetchWithSsrFGuard: mocks.fetchWithSsrFGuard,
}));

import { downloadVerifiedFile } from "./llama-server-install.js";
import { stagingMetaPath, stagingPartPath } from "./resumable-download.js";

const MODEL_URL = "https://downloads.example/model.gguf";
const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  mocks.fetchWithSsrFGuard.mockReset();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llama-resume-"));
  tempRoots.push(root);
  return root;
}

async function stagePartial(destination: string, bytes: string, recordedSha256?: string) {
  const partPath = stagingPartPath(destination);
  await fs.writeFile(partPath, bytes);
  if (recordedSha256 !== undefined) {
    await fs.writeFile(stagingMetaPath(partPath), recordedSha256);
  }
  return partPath;
}

/**
 * How the origin answers `Range: bytes=N-`:
 *  - `honor`: 206 with the tail from N (the Hugging Face CDN behaviour);
 *  - `ignore`: 200 with the full body (CDNs/mirrors/proxies that drop Range);
 *  - `wrong-offset`: 206 but for the whole file (`bytes 0-…`), a broken proxy.
 */
type RangeMode = "honor" | "ignore" | "wrong-offset";

function rangeResponse(bytes: Buffer, range: string | undefined, mode: RangeMode): Response {
  const match = range ? /^bytes=(\d+)-$/u.exec(range) : null;
  const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
  if (range && start >= bytes.length) {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { "content-range": `bytes */${bytes.length}` },
    });
  }
  if (range && mode === "ignore") {
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-length": String(bytes.length) },
    });
  }
  if (range && mode === "wrong-offset") {
    return new Response(new Uint8Array(bytes), {
      status: 206,
      headers: {
        "content-length": String(bytes.length),
        "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      },
    });
  }
  const payload = range ? bytes.subarray(start) : bytes;
  return new Response(new Uint8Array(payload), {
    status: range ? 206 : 200,
    headers: {
      "content-length": String(payload.length),
      ...(range ? { "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}),
    },
  });
}

/**
 * A fetch fixture that honors `Range: bytes=N-` and records how each request
 * asked for the file (`"full"` when no Range was sent), so tests can assert
 * resume-vs-fresh behaviour. `serve` picks the bytes for each request number.
 */
function installRangeAwareFetchFixture(
  serve: (requestNumber: number) => string,
  mode: RangeMode = "honor",
): { requests: string[] } {
  const requests: string[] = [];
  mocks.fetchWithSsrFGuard.mockImplementation(async ({ init }: { init?: RequestInit }) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range;
    requests.push(range ?? "full");
    const bytes = Buffer.from(serve(requests.length));
    return { response: rangeResponse(bytes, range, mode), release: vi.fn() };
  });
  return { requests };
}

const freshText = "GGUF gemma4 current text model bytes served by the hub today";
const freshVoice = "GGUF current voice model bytes served by the hub today";
const staleText = "GGUF qwen35 stale text model bytes from the old publication";
const prefixLen = 17;

function download(destination: string, content: string) {
  return downloadVerifiedFile({
    url: MODEL_URL,
    destination,
    expectedSha256: sha256(content),
    expectedSize: Buffer.byteLength(content),
    resumable: true,
  });
}

describe("local inference downloader stale-content robustness", () => {
  it("discards a stale .part instead of range-resuming it into a corrupt blob", async () => {
    const root = await createRoot();
    const text = path.join(root, "text.gguf");
    const voice = path.join(root, "voice.gguf");
    const { requests } = installRangeAwareFetchFixture((requestNumber) =>
      requestNumber === 1 ? freshText : freshVoice,
    );
    // Two stale-partial provenances, both from the OLD content version:
    // - text: `.part` stamped with the OLD content's sha;
    // - voice: `.part` with no sidecar at all (unknown provenance).
    // Resuming either would append new-version bytes onto old-version bytes.
    const textPart = await stagePartial(text, "GGUF qwen35 partial", sha256(staleText));
    const voicePart = await stagePartial(voice, "GGUF old voice par");

    await download(text, freshText);
    await download(voice, freshVoice);

    // Neither stale partial was resumed: no Range request went out for them.
    expect(requests).toEqual(["full", "full"]);
    expect(await fs.readFile(text, "utf8")).toBe(freshText);
    expect(await fs.readFile(voice, "utf8")).toBe(freshVoice);
    // No staging residue (part or sidecar) left behind.
    await expect(fs.stat(textPart)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stagingMetaPath(textPart))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(voicePart)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(root)).toSorted()).toEqual(["text.gguf", "voice.gguf"]);
  });

  it("still range-resumes a valid .part recorded against the current manifest sha", async () => {
    const root = await createRoot();
    const destination = path.join(root, "model.gguf");
    const { requests } = installRangeAwareFetchFixture(() => freshText);
    // A genuine interrupted download of the CURRENT content: the partial is
    // a strict prefix and the sidecar records the current sha.
    await stagePartial(destination, freshText.slice(0, prefixLen), sha256(freshText));

    await download(destination, freshText);

    // The resume path fired: one Range request from the partial's offset...
    expect(requests).toEqual([`bytes=${prefixLen}-`]);
    // ...and prefix + tail joined into the exact current content.
    expect(await fs.readFile(destination, "utf8")).toBe(freshText);
    expect(await fs.readdir(root)).toEqual(["model.gguf"]);
  });

  it.each([
    {
      mode: "ignore" as const,
      label: "ignores Range and answers 200 with the full body",
      expectedRequests: (prefix: number) => [`bytes=${prefix}-`],
    },
    {
      mode: "wrong-offset" as const,
      label: "answers the resume with a 206 for a different range",
      expectedRequests: (prefix: number) => [`bytes=${prefix}-`, "full"],
    },
  ])(
    "restarts from byte 0, never appends, when the origin $label (#26629)",
    async ({ mode, expectedRequests }) => {
      const root = await createRoot();
      const destination = path.join(root, "model.gguf");
      const { requests } = installRangeAwareFetchFixture(() => freshText, mode);
      // A genuine interrupted download of the current content: a strict
      // prefix with the current sha recorded, so a resume is tried.
      await stagePartial(destination, freshText.slice(0, prefixLen), sha256(freshText));

      await download(destination, freshText);

      // Exactly the resume attempt (plus the whole-file re-request for an
      // unusable 206): the first write was already byte-exact rather than
      // full-body-appended-to-prefix.
      expect(requests).toEqual(expectedRequests(prefixLen));
      expect(await fs.readFile(destination, "utf8")).toBe(freshText);
      expect((await fs.stat(destination)).size).toBe(Buffer.byteLength(freshText));
    },
  );

  it("commits a complete .part after restart without requesting a range past EOF", async () => {
    const root = await createRoot();
    const destination = path.join(root, "model.gguf");
    const { requests } = installRangeAwareFetchFixture(() => freshText);
    const partPath = await stagePartial(destination, freshText, sha256(freshText));

    await download(destination, freshText);

    expect(requests).toEqual([]);
    expect(await fs.readFile(destination, "utf8")).toBe(freshText);
    await expect(fs.stat(partPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stagingMetaPath(partPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("re-fetches from scratch when a completed transfer fails the sha gate (stale edge)", async () => {
    const root = await createRoot();
    const destination = path.join(root, "model.gguf");
    // The resumed tail comes from a CDN edge that has not seen the re-publish
    // yet; the whole-file re-fetch serves the current bytes.
    const { requests } = installRangeAwareFetchFixture((requestNumber) =>
      requestNumber === 1 ? staleText : freshText,
    );
    await stagePartial(destination, freshText.slice(0, prefixLen), sha256(freshText));

    await download(destination, freshText);

    expect(requests).toEqual([`bytes=${prefixLen}-`, "full"]);
    expect(await fs.readFile(destination, "utf8")).toBe(freshText);
    expect(await fs.readdir(root)).toEqual(["model.gguf"]);
  });

  it("fails after bounded re-fetches and leaves no wrong-content file on disk", async () => {
    const root = await createRoot();
    const destination = path.join(root, "model.gguf");
    // The origin persistently serves bytes that do not match the expected sha.
    // Every attempt must be discarded.
    const { requests } = installRangeAwareFetchFixture(() => staleText);
    const partPath = await stagePartial(
      destination,
      freshText.slice(0, prefixLen),
      sha256(freshText),
    );

    await expect(download(destination, freshText)).rejects.toThrow(/download SHA-256 mismatch/u);

    expect(requests).toEqual([`bytes=${prefixLen}-`, "full"]);
    // The wrong bytes never survive under the final name, and no staging residue remains.
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(partPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stagingMetaPath(partPath))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
