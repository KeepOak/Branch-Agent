#!/usr/bin/env node
import { closeSync, openSync, writeSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { retainingPaths, summarize } from "./heap-snapshot-diff.mjs";

/** Capture the main isolate of an explicitly selected, inspector-enabled Node gateway. */
export async function captureSnapshot(inspectorUrl, file) {
  const url = new URL(inspectorUrl);
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Expected a Node inspector WebSocket URL");
  }
  const fd = openSync(file, "wx", 0o600);
  let socket;
  try {
    await new Promise((resolve, reject) => {
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method: "HeapProfiler.takeHeapSnapshot" }));
      });
      socket.addEventListener("error", () => reject(new Error("Inspector connection failed")));
      socket.addEventListener("close", () =>
        reject(new Error("Inspector closed before capture completed")),
      );
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.method === "HeapProfiler.addHeapSnapshotChunk") {
            // Write synchronously: do not buffer a multi-GB snapshot in this process.
            const bytes = Buffer.from(message.params.chunk);
            let offset = 0;
            while (offset < bytes.length) {
              offset += writeSync(fd, bytes, offset, bytes.length - offset);
            }
          } else if (message.id === 1) {
            if (message.error) {
              reject(new Error(message.error.message));
            } else {
              resolve();
            }
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    socket?.close();
    closeSync(fd);
  }
}

/** Retained ownership is the strong-edge dominator relation, not allocation provenance. */
export function generateReport(file, { top = 30, maxDepth = 40 } = {}) {
  for (const value of [top, maxDepth]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Report limits must be positive safe integers");
    }
  }
  const snapshot = summarize(file, true);
  const constructors = snapshot.labels
    .map((label, index) => ({
      label,
      count: snapshot.totals[index].count,
      shallowBytes: snapshot.totals[index].shallow,
      retainedBytes: snapshot.totals[index].retained,
    }))
    .sort((a, b) => b.retainedBytes - a.retainedBytes)
    .slice(0, top);
  // Keep only the requested largest owners, rather than allocating one row per node.
  const owners = [];
  for (let node = 1; node < snapshot.count; node++) {
    const retained = snapshot.retained[node];
    if (!retained || (owners.length === top && retained <= owners.at(-1).retainedBytes)) {
      continue;
    }
    const parent = snapshot.immediateDominators[node];
    owners.push({
      id: snapshot.ids[node],
      label: snapshot.labels[snapshot.names[node]],
      retainedBytes: retained,
      immediateOwnerId: snapshot.ids[parent],
      immediateOwnerLabel: snapshot.labels[snapshot.names[parent]],
    });
    owners.sort((a, b) => b.retainedBytes - a.retainedBytes);
    if (owners.length > top) {
      owners.pop();
    }
  }
  return {
    metric: "strong-edge-dominator-retained-bytes",
    nodes: snapshot.count,
    reachableNodes: snapshot.visited,
    totalRetainedBytes: snapshot.retained[0],
    constructors,
    owners,
    retainingPaths: retainingPaths(
      file,
      snapshot,
      { classes: [], dominators: [] },
      {
        nodes: owners.map((owner) => owner.id),
        maxDepth,
      },
    ),
    notes: [
      "Main isolate only; worker heaps, RSS and external memory need separate diagnostic memory signals.",
      "Weak and shortcut edges excluded; ephemerons follow V8 encoded internal edges.",
      "Constructor totals are unions within each class but overlap between classes. Owner subtrees also overlap; do not sum rows.",
      "Owners are individual dominators, not inferred subsystem buckets. Root paths are one shortest strong path; use edge names and dominator chains to identify subsystem owners and runtime generations.",
      "Inspect prepared-runtime owners and generations, in-memory transcripts, code-mode pools, and the diagnostic ring first.",
    ],
  };
}

export async function writeReport(snapshotFile, reportFile, options) {
  const report = generateReport(snapshotFile, options);
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        "inspector-url": { type: "string" },
        snapshot: { type: "string" },
        report: { type: "string" },
        top: { type: "string", default: "30" },
        "max-depth": { type: "string", default: "40" },
      },
    });
    if (!values.snapshot || !values.report) {
      throw new Error(
        "Usage: node scripts/gateway-heap-profile.mjs [--inspector-url URL] --snapshot FILE --report FILE [--top N] [--max-depth N]",
      );
    }
    if (values["inspector-url"]) {
      await captureSnapshot(values["inspector-url"], values.snapshot);
    }
    await writeReport(values.snapshot, values.report, {
      top: Number(values.top),
      maxDepth: Number(values["max-depth"]),
    });
    console.log("Heap report written");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
