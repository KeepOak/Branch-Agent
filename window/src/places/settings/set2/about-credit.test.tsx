// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { About } from "./updates";

const CREDIT = "Based on OpenClaw";
// Vitest runs from the window directory; jsdom gives import.meta.url a non-file scheme.
const SRC = path.resolve(process.cwd(), "src");
const CREDIT_FILE = path.resolve(SRC, "places/settings/set2/updates.tsx");
const THIS_FILE = path.resolve(SRC, "places/settings/set2/about-credit.test.tsx");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

it("renders the Based on OpenClaw credit exactly once, in Updates & about", async () => {
  await act(async () => root.render(<About />));
  const occurrences = (host.textContent ?? "").split(CREDIT).length - 1;
  expect(occurrences).toBe(1);
});

it("no other window source file contains the credit line", () => {
  const others = sourceFiles(SRC).filter((file) => file !== CREDIT_FILE && file !== THIS_FILE);
  const hits = others.filter((file) => readFileSync(file, "utf8").includes(CREDIT));
  expect(hits).toEqual([]);
});
