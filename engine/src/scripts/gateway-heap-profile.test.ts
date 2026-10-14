import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
async function loadTools() {
  // Load inside each case so the base proof records individual failures, not a collection error.
  const report = await import("../../scripts/gateway-heap-profile.mjs");
  const parser = await import("../../scripts/heap-snapshot-diff.mjs");
  return { ...report, ...parser };
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "heap-report-"));
  directories.push(directory);
  const file = join(directory, "fixture.heapsnapshot");
  // root -> owner -> nested owner -> payload; root -> shared <- owner.
  // The weak reference to an otherwise unreachable node must not retain it.
  writeFileSync(
    file,
    JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ["type", "name", "id", "self_size", "edge_count"],
          node_types: [["synthetic", "object", "string"], "string", "number", "number", "number"],
          edge_fields: ["type", "name_or_index", "to_node"],
          edge_types: [["property", "weak", "shortcut"], "string_or_number", "node"],
        },
        node_count: 6,
        edge_count: 7,
      },
      nodes: [
        0, 0, 1, 0, 3, 1, 1, 3, 10, 3, 1, 1, 5, 20, 1, 2, 2, 7, 30, 0, 1, 3, 9, 40, 0, 1, 4, 11,
        100, 0,
      ],
      edges: [0, 5, 5, 0, 6, 20, 1, 7, 25, 0, 8, 10, 0, 6, 20, 2, 7, 25, 0, 9, 15],
      strings: [
        "(root)",
        "PreparedRuntime",
        "payload",
        "Shared",
        "WeakOnly",
        "runtime",
        "shared",
        "weak",
        "generation",
        "transcript",
      ],
    }),
  );
  return { file, directory };
}

describe("gateway heap profile", () => {
  it("captures a running Node isolate and writes its report without closing the target", async () => {
    const { captureSnapshot, writeReport } = await loadTools();
    const directory = mkdtempSync(join(tmpdir(), "heap-capture-"));
    directories.push(directory);
    const child = spawn(
      process.execPath,
      [
        "--inspect=0",
        "-e",
        "globalThis.owner = { payload: new Array(100).fill('fixture') }; setInterval(() => {}, 1000)",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    try {
      const inspectorUrl = await new Promise<string>((resolve, reject) => {
        let output = "";
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Fixture exited before inspector startup")));
        child.stderr.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(/ws:\/\/\S+/u);
          if (match) resolve(match[0]);
        });
      });
      const file = join(directory, "capture.heapsnapshot");
      await captureSnapshot(inspectorUrl, file);
      const reportFile = join(directory, "report.json");
      const report = await writeReport(file, reportFile, { top: 3 });
      expect(report.totalRetainedBytes).toBeGreaterThan(0);
      expect(report.owners).toHaveLength(3);
      expect(JSON.parse(readFileSync(reportFile, "utf8")).metric).toBe(report.metric);
      expect(child.exitCode).toBeNull();
    } finally {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
  }, 30_000);

  it("parses numeric snapshot columns and excludes weak and shortcut retainers", async () => {
    const { readGraph } = await loadTools();
    const { file } = fixture();
    const graph = readGraph(file);
    expect(graph.count).toBe(6);
    expect([...graph.sizes]).toEqual([0, 10, 20, 30, 40, 100]);
    expect([...graph.targets]).toEqual([1, 4, 6, 2, 4, 6, 3]);
  });

  it("reports constructor unions and individual owners with shared retention and named paths", async () => {
    const { generateReport, writeReport } = await loadTools();
    const { file, directory } = fixture();
    const reportFile = join(directory, "report.json");
    const report = await writeReport(file, reportFile, { top: 10 });
    expect(report.totalRetainedBytes).toBe(100);
    expect(report.reachableNodes).toBe(5);
    expect(report.constructors.find((row) => row.label === "object: PreparedRuntime")).toEqual({
      label: "object: PreparedRuntime",
      count: 2,
      shallowBytes: 30,
      retainedBytes: 60,
    });
    expect(report.owners.find((row) => row.id === 3)).toMatchObject({
      retainedBytes: 60,
      immediateOwnerId: 1,
    });
    expect(report.owners.find((row) => row.id === 9)).toMatchObject({
      retainedBytes: 40,
      immediateOwnerId: 1,
    });
    expect(report.owners.some((row) => row.id === 11)).toBe(false);
    expect(
      report.retainingPaths.find((row) => row.id === 7)?.rootPath?.nodes.at(-1)?.incomingEdge,
    ).toEqual({ type: "property", name: "transcript" });
    expect(JSON.parse(readFileSync(reportFile, "utf8"))).toEqual(report);
    expect(generateReport(file, { top: 1 }).owners).toHaveLength(1);
    expect(() => generateReport(file, { top: 0 })).toThrow("positive safe integers");
  });

  it("rejects a truncated snapshot instead of producing a partial report", async () => {
    const { readGraph } = await loadTools();
    const { file } = fixture();
    writeFileSync(file, '{"snapshot":');
    expect(() => readGraph(file)).toThrow("Truncated heap snapshot");
  });
});
