// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_sandbox_network_config.py (atlas SAFETY-0044)
import { describe, expect, it } from "vitest";
import { resolveSandboxConfigForAgent } from "../config.js";
import { resolveSandboxNetworkPolicy, SandboxNetworkPolicySchema } from "./network-config.js";

describe("sandbox network config", () => {
  it("test_sandbox_network_defaults_to_open", () => {
    const config = resolveSandboxConfigForAgent({});
    const network = resolveSandboxNetworkPolicy(config.docker.networkPolicy);

    expect(network.mode).toBe("open");
    expect(network.allowDomains).toEqual([]);
    expect(network.approval).toBe("prompt");
  });

  it("test_sandbox_network_normalizes_domains", () => {
    const parsed = SandboxNetworkPolicySchema.parse({
      allowDomains: ["PyPI.org.", "*.PythonHosted.org", "pypi.org"],
    });

    expect(resolveSandboxNetworkPolicy(parsed).allowDomains).toEqual([
      "pypi.org",
      "*.pythonhosted.org",
    ]);
  });

  it.each([
    "*",
    "https://pypi.org",
    "pypi.org:443",
    "foo.*.example.com",
    "../example.com",
    "127.0.0.1",
    "localhost",
    "foo..example.com",
    "-foo.example.com",
    "foo_.example.com",
  ])("test_sandbox_network_rejects_unsafe_domain_rules[%s]", (domain) => {
    const result = SandboxNetworkPolicySchema.safeParse({ allowDomains: [domain] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join("\n")).toMatch(
      /invalid sandbox network allowlist domain/,
    );
  });
});
