import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSignalStateStore, signalWakeStatePath } from "./signal-wake-state.js";

const dirs: string[] = [];
const STATES = new Map([
  ["KeepOak/Branch-Agent", new Map([[7, { redSha: "a".repeat(40), fixCommentId: 202 }]])],
]);
const OLDER = new Map([["KeepOak/Branch-Agent", new Map([[7, { redSha: "9".repeat(40) }]])]]);

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "signal-state-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "signal-wakes"), { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file signal state store", () => {
  it("reads empty, not record-only, when no file exists", async () => {
    const dir = await tempDir();
    const load = await createFileSignalStateStore(signalWakeStatePath(dir)).read();
    expect(load).toEqual({ states: new Map(), recordOnly: false });
  });

  it("round-trips PR state across a new store instance", async () => {
    const dir = await tempDir();
    const file = signalWakeStatePath(dir);
    await createFileSignalStateStore(file).write(STATES);
    const load = await createFileSignalStateStore(file).read();
    expect(load.states).toEqual(STATES);
    expect(load.recordOnly).toBe(false);
    expect(load.warning).toBeUndefined();
  });

  it("keeps the previous valid file as a backup on each write", async () => {
    const dir = await tempDir();
    const file = signalWakeStatePath(dir);
    const store = createFileSignalStateStore(file);
    await store.write(OLDER);
    await store.write(STATES);
    const backup = JSON.parse(
      await readFile(path.join(dir, "signal-wakes", "state.json.bak"), "utf8"),
    );
    expect(backup.repos["KeepOak/Branch-Agent"]["7"]).toEqual({ redSha: "9".repeat(40) });
  });

  it("falls back to the backup with a warning when the file is corrupt", async () => {
    const dir = await tempDir();
    const file = signalWakeStatePath(dir);
    const store = createFileSignalStateStore(file);
    await store.write(OLDER);
    await store.write(STATES);
    await writeFile(file, "{ not json", "utf8");
    const load = await createFileSignalStateStore(file).read();
    expect(load.states).toEqual(OLDER);
    expect(load.recordOnly).toBe(false);
    expect(load.warning).toContain("restored the last good backup");
  });

  it("is record-only, with a warning, when the file and its backup are both unusable", async () => {
    const dir = await tempDir();
    const file = signalWakeStatePath(dir);
    await writeFile(file, "{ not json", "utf8");
    await writeFile(path.join(dir, "signal-wakes", "state.json.bak"), '{"version":2}', "utf8");
    const load = await createFileSignalStateStore(file).read();
    expect(load.states).toEqual(new Map());
    expect(load.recordOnly).toBe(true);
    expect(load.warning).toContain("record");
  });

  it("does not replace a corrupt file's backup with the corrupt content", async () => {
    const dir = await tempDir();
    const file = signalWakeStatePath(dir);
    const store = createFileSignalStateStore(file);
    await store.write(OLDER);
    await store.write(STATES);
    await writeFile(file, "{ not json", "utf8");
    await store.write(STATES);
    const backup = JSON.parse(
      await readFile(path.join(dir, "signal-wakes", "state.json.bak"), "utf8"),
    );
    expect(backup.repos["KeepOak/Branch-Agent"]["7"]).toEqual({ redSha: "9".repeat(40) });
  });
});
