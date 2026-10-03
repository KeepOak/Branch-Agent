import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyTemporalDecayToHybridResults } from "./temporal-decay.js";

const nowMs = Date.UTC(2026, 1, 10);
const oldMs = nowMs - 30 * 24 * 60 * 60 * 1000;
const temporalDecay = { enabled: true, halfLifeDays: 30 };

describe("legacy evergreen root memory", () => {
  it.each(["memory.md", "./memory.md", ".\\memory.md"])(
    "does not decay the supported legacy root %s using indexed host mtimes",
    async (filePath) => {
      const results = [{ path: filePath, score: 0.9, source: "memory" }];
      const ranked = await applyTemporalDecayToHybridResults({
        results, temporalDecay, nowMs,
        memorySourceMtimes: new Map([[filePath, oldMs]]),
      });
      expect(ranked[0]?.score).toBe(0.9);
      expect(ranked[0]).toBe(results[0]);
    },
  );

  it("preserves legacy durable memory read from a real local file", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-memory-legacy-decay-"));
    try {
      const file = path.join(workspaceDir, "memory.md");
      await fs.writeFile(file, "A durable preference.\n");
      await fs.utimes(file, new Date(oldMs), new Date(oldMs));
      const ranked = await applyTemporalDecayToHybridResults({
        results: [{ path: "memory.md", score: 1, source: "memory" }],
        temporalDecay, nowMs, workspaceDir,
      });
      expect(ranked[0]?.score).toBe(1);
      expect(await fs.readFile(file, "utf8")).toBe("A durable preference.\n");
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("continues aging an imported same-named file and a session identity", async () => {
    const ranked = await applyTemporalDecayToHybridResults({
      results: [
        { path: "imports/memory.md", score: 1, source: "memory" },
        { path: "memory.md", score: 1, source: "sessions" },
      ],
      temporalDecay, nowMs,
      memorySourceMtimes: new Map([["imports/memory.md", oldMs]]),
      sessionSourceMtimes: new Map([["memory.md", oldMs]]),
    });
    expect(ranked.map((entry) => entry.score)).toEqual([0.5, 0.5]);
  });
});
