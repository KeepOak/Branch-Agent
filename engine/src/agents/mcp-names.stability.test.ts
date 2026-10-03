import { describe, expect, it } from "vitest";
import { buildSafeToolName, normalizeReservedToolNames } from "./agent-bundle-mcp-names.js";

function register(toolNames: string[]) {
  const names = new Map<string, string>();
  const reservedNames = normalizeReservedToolNames();
  for (const toolName of toolNames) {
    const name = buildSafeToolName({ serverName: "source", toolName, reservedNames });
    reservedNames.add(name.toLowerCase());
    names.set(toolName, name);
  }
  return names;
}
describe("MCP stable long-name registration", () => {
  it("keeps identity when colliding long tool discovery order reverses", () => {
    const a = "lookup_" + "x".repeat(80) + "_accounts";
    const b = "lookup_" + "x".repeat(80) + "_transactions";
    const forward = register([a, b]);
    const reverse = register([b, a]);
    expect(forward.get(a)).toBe(reverse.get(a));
    expect(forward.get(b)).toBe(reverse.get(b));
    expect(forward.get(a)).not.toBe(forward.get(b));
  });
  it("keeps an existing long tool's identity when another colliding tool is added", () => {
    const a = "z".repeat(100) + "_a";
    const b = "z".repeat(100) + "_b";
    expect(register([a]).get(a)).toBe(register([b, a]).get(a));
  });
  it("retains the namespace and provider length budget with reserved collisions", () => {
    const toolName = "q".repeat(120);
    const first = buildSafeToolName({
      serverName: "namespace",
      toolName,
      reservedNames: new Set(),
    });
    const second = buildSafeToolName({
      serverName: "namespace",
      toolName,
      reservedNames: new Set([first.toLowerCase()]),
    });
    expect(first).toMatch(/^namespace__[a-zA-Z0-9_-]+$/);
    expect(second).toMatch(/^namespace__[a-zA-Z0-9_-]+$/);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(second.length).toBeLessThanOrEqual(64);
    expect(first).not.toBe(second);
  });
});
