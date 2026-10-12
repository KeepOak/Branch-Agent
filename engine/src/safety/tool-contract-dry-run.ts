// provos/ironcurtain@8f9c75a720337271caf1e18c199fcca2d299ad27:src/pipeline/policy-verifier.ts (atlas AGENT-LOOP-0332; changed: examples verified through Branch's own tool-policy matcher)
// Tool contract dry-run (atlas AGENT-LOOP-0332, R-1559): explain why one tool call would be allowed or refused,
// layer by layer, and check the contract's own examples when it loads. Idea (scenarios verified against the real
// policy engine at load) from provos/ironcurtain@8f9c75a720337271caf1e18c199fcca2d299ad27:
// src/pipeline/policy-verifier.ts. Matching is the engine's own isToolAllowedByPolicyName; no second matcher.
import type { SandboxToolPolicy } from "../agents/sandbox/types.js";
import { isToolAllowedByPolicyName } from "../agents/tool-policy-match.js";

export type ContractLayer = Readonly<{ label: string; policy: SandboxToolPolicy }>;
export type ContractExample = Readonly<{ tool: string; expect: "allowed" | "refused" }>;
export type ToolContract = Readonly<{
  name: string;
  layers: readonly ContractLayer[];
  examples: readonly ContractExample[];
}>;

export type LayerVerdict = Readonly<{
  label: string;
  allows: boolean;
  why: "denied by name" | "not on the allow list" | "allowed";
}>;
export type DryRunExplanation = Readonly<{
  tool: string;
  allowed: boolean;
  layers: readonly LayerVerdict[];
}>;

function explainLayer(tool: string, layer: ContractLayer): LayerVerdict {
  const { deny } = layer.policy;
  if (deny?.length && !isToolAllowedByPolicyName(tool, { deny })) {
    return { label: layer.label, allows: false, why: "denied by name" };
  }
  if (!isToolAllowedByPolicyName(tool, layer.policy)) {
    return { label: layer.label, allows: false, why: "not on the allow list" };
  }
  return { label: layer.label, allows: true, why: "allowed" };
}

/** Explain one call: every layer's verdict; the call is allowed only if every layer allows it. */
export function explainToolCall(contract: ToolContract, tool: string): DryRunExplanation {
  const layers = contract.layers.map((layer) => explainLayer(tool, layer));
  return Object.freeze({ tool, allowed: layers.every((l) => l.allows), layers });
}

/** One plain sentence for the owner. */
export function describeDryRun(explanation: DryRunExplanation): string {
  if (explanation.allowed) {
    return `${explanation.tool} would be allowed: every rule allows it.`;
  }
  const refusing = explanation.layers.filter((l) => !l.allows);
  const reasons = refusing.map((l) => `${l.label} (${l.why})`).join("; ");
  return `${explanation.tool} would be refused by ${reasons}.`;
}

export class ToolContractExampleError extends Error {
  constructor(readonly mismatches: readonly string[]) {
    super(`Tool contract examples do not match the rules: ${mismatches.join("; ")}`);
    this.name = "ToolContractExampleError";
  }
}

/** Load a contract: every example is run through the dry-run and must come out as its author said. */
export function loadToolContract(contract: ToolContract): ToolContract {
  const mismatches = contract.examples
    .map((example) => ({ example, got: explainToolCall(contract, example.tool) }))
    .filter(({ example, got }) => (example.expect === "allowed") !== got.allowed)
    .map(
      ({ example, got }) =>
        `${example.tool} expected ${example.expect}, got ${got.allowed ? "allowed" : "refused"}`,
    );
  if (mismatches.length > 0) {
    throw new ToolContractExampleError(mismatches);
  }
  return contract;
}
