// Behaviour tests for resumable llama.cpp downloads (atlas MODELS-ACCOUNTS-0141).
// Upstream covers resolveResumeOffset only through its Downloader class; these
// pin the helper directly and the interrupt-then-resume flow Branch relies on.
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
import { resolveResumeOffset, stagingMetaPath, stagingPartPath } from "./resumable-download.js";

const MODEL_URL = "https://downloads.example/model.gguf";
const content = Buffer.from("GGUF resumable model bytes that arrive across two attempts");
const digest = createHash("sha256").update(content).digest("hex");
const prefixLen = 17;
const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  mocks.fetchWithSsrFGuard.mockReset();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createDestination(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llama-resume-behaviour-"));
  tempRoots.push(root);
  return path.join(root, "model.gguf");
}

/** A body that delivers the prefix, then fails the way a dropped connection or a cancel does. */
function interruptedBody(failure: () => Promise<Error>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(content.subarray(0, prefixLen)));
    },
    async pull(controller) {
      controller.error(await failure());
    },
  });
}

function serveRanges(): string[] {
  const requests: string[] = [];
  mocks.fetchWithSsrFGuard.mockImplementation(async ({ init }: { init?: RequestInit }) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range;
    requests.push(range ?? "full");
    const start = range ? Number.parseInt(/^bytes=(\d+)-$/u.exec(range)?.[1] ?? "0", 10) : 0;
    if (range && start >= content.length) {
      return {
        response: new Response("range not satisfiable", { status: 416 }),
        release: vi.fn(),
      };
    }
    const payload = content.subarray(start);
    const headers: Record<string, string> = { "content-length": String(payload.length) };
    if (range) {
      headers["content-range"] = `bytes ${start}-${content.length - 1}/${content.length}`;
    }
    return {
      response: new Response(new Uint8Array(payload), { status: range ? 206 : 200, headers }),
      release: vi.fn(),
    };
  });
  return requests;
}

describe("resolveResumeOffset", () => {
  it.each([
    { label: "a fresh request", start: 0, status: 200, range: undefined, expected: 0 },
    {
      label: "an origin that ignored Range",
      start: 17,
      status: 200,
      range: undefined,
      expected: 0,
    },
    { label: "a matching 206", start: 17, status: 206, range: "bytes 17-99/100", expected: 17 },
    {
      label: "a 206 with unknown length",
      start: 17,
      status: 206,
      range: "bytes 17-99/*",
      expected: 17,
    },
    {
      label: "a 206 at another offset",
      start: 17,
      status: 206,
      range: "bytes 0-99/100",
      expected: null,
    },
    {
      label: "a 206 without Content-Range",
      start: 17,
      status: 206,
      range: undefined,
      expected: null,
    },
  ])("returns $expected for $label", ({ start, status, range, expected }) => {
    expect(resolveResumeOffset(start, status, { "content-range": range })).toBe(expected);
  });

  it("reads the first value of a repeated Content-Range header", () => {
    expect(
      resolveResumeOffset(17, 206, { "content-range": ["bytes 17-99/100", "bytes 0-99/100"] }),
    ).toBe(17);
  });
});

describe("resumable llama.cpp downloads", () => {
  it("keeps staged bytes after a dropped connection and resumes them on the next attempt", async () => {
    const destination = await createDestination();
    const partPath = stagingPartPath(destination);
    mocks.fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(interruptedBody(async () => new Error("socket reset"))),
      release: vi.fn(),
    });
    const params = {
      url: MODEL_URL,
      destination,
      expectedSha256: digest,
      expectedSize: content.length,
      resumable: true,
    };

    await expect(downloadVerifiedFile(params)).rejects.toThrow("socket reset");
    expect((await fs.stat(partPath)).size).toBe(prefixLen);
    expect((await fs.readFile(stagingMetaPath(partPath), "utf8")).trim()).toBe(digest);
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });

    const requests = serveRanges();
    const onProgress = vi.fn();
    await downloadVerifiedFile({ ...params, onProgress });

    expect(requests).toEqual([`bytes=${prefixLen}-`]);
    expect(await fs.readFile(destination)).toEqual(content);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ downloadedSize: content.length, totalSize: content.length }),
    );
    expect(await fs.readdir(path.dirname(destination))).toEqual(["model.gguf"]);
  });

  it("keeps staged bytes when the download is cancelled so setup can continue later", async () => {
    const destination = await createDestination();
    const controller = new AbortController();
    mocks.fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(
        interruptedBody(async () => {
          controller.abort();
          return controller.signal.reason as Error;
        }),
      ),
      release: vi.fn(),
    });

    await expect(
      downloadVerifiedFile({
        url: MODEL_URL,
        destination,
        expectedSha256: digest,
        resumable: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect((await fs.stat(stagingPartPath(destination))).size).toBe(prefixLen);
    const requests = serveRanges();
    await downloadVerifiedFile({
      url: MODEL_URL,
      destination,
      expectedSha256: digest,
      resumable: true,
    });
    expect(requests).toEqual([`bytes=${prefixLen}-`]);
    expect(await fs.readFile(destination)).toEqual(content);
  });

  it("restarts from byte 0 when the origin refuses the resume with 416", async () => {
    const destination = await createDestination();
    const partPath = stagingPartPath(destination);
    // Without a known size the complete partial cannot be committed up front,
    // so the resume asks past EOF and the origin answers 416.
    await fs.writeFile(partPath, content);
    await fs.writeFile(stagingMetaPath(partPath), digest);
    const requests = serveRanges();

    await downloadVerifiedFile({
      url: MODEL_URL,
      destination,
      expectedSha256: digest,
      resumable: true,
    });

    expect(requests).toEqual([`bytes=${content.length}-`, "full"]);
    expect(await fs.readFile(destination)).toEqual(content);
    expect(await fs.readdir(path.dirname(destination))).toEqual(["model.gguf"]);
  });

  it("does not stage a resumable partial when the digest is only known from the server", async () => {
    const destination = await createDestination();
    mocks.fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(interruptedBody(async () => new Error("socket reset"))),
      release: vi.fn(),
    });

    await expect(
      downloadVerifiedFile({ url: MODEL_URL, destination, resumable: true }),
    ).rejects.toThrow("socket reset");

    expect(await fs.readdir(path.dirname(destination))).toEqual([]);
  });
});
