import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSignalStateStore, signalWakeStatePath } from "./signal-wake-state.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file signal state store", () => {
  it("reads empty when no file exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "signal-state-"));
    dirs.push(dir);
    const store = createFileSignalStateStore(signalWakeStatePath(dir));
    expect(await store.read()).toEqual(new Map());
  });

  it("round-trips PR state across a new store instance", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "signal-state-"));
    dirs.push(dir);
    const file = signalWakeStatePath(dir);
    const states = new Map([
      ["KeepOak/Branch-Agent", new Map([[7, { redSha: "a".repeat(40), fixCommentId: 202 }]])],
    ]);
    await createFileSignalStateStore(file).write(states);
    const reread = await createFileSignalStateStore(file).read();
    expect(reread).toEqual(states);
  });
});
