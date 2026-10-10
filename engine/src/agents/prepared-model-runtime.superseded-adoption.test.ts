import { describe, expect, it } from "vitest";
import { PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.errors.js";
import { ownerKey } from "./prepared-model-runtime.owner.js";
import { adoptSupersedingPublication } from "./prepared-model-runtime.superseded-adoption.js";
import type {
  PreparedModelRuntimeInput,
  PreparedModelRuntimeOwner,
} from "./prepared-model-runtime.types.js";

const input = {
  config: {},
  agentId: "worker",
  agentDir: "/scratch/agents/worker",
} as unknown as PreparedModelRuntimeInput;
const otherInput = {
  config: { plugins: { allow: [] } },
  agentId: "worker",
  agentDir: "/scratch/agents/worker",
} as unknown as PreparedModelRuntimeInput;

/** Counts reads so a spinning loop fails the test instead of hanging it. */
class GuardedOwners extends Map<string, PreparedModelRuntimeOwner> {
  reads = 0;
  override get(key: string): PreparedModelRuntimeOwner | undefined {
    this.reads += 1;
    if (this.reads > 1000) {
      throw new Error("adoption kept reading the owner map");
    }
    return super.get(key);
  }
}

function ownerWith(owner: Partial<PreparedModelRuntimeOwner>): PreparedModelRuntimeOwner {
  return owner as PreparedModelRuntimeOwner;
}

describe("superseded publication adoption", () => {
  it("does not spin on a settled pending promise that stays installed", async () => {
    const owners = new GuardedOwners();
    const settled = Promise.resolve(undefined);
    owners.set(ownerKey(input), ownerWith({ input, pending: settled }));
    const superseded = new PreparedModelRuntimePublicationSupersededError(
      "prepared model runtime publication was superseded",
    );

    await expect(adoptSupersedingPublication(owners, input, superseded)).rejects.toBe(superseded);
    expect(owners.reads).toBeLessThan(20);
  });

  it("adopts a current successor built for the same input", async () => {
    const owners = new Map<string, PreparedModelRuntimeOwner>();
    const successor = { isCurrent: () => true } as never;
    owners.set(ownerKey(input), ownerWith({ input, snapshot: successor }));
    const superseded = new PreparedModelRuntimePublicationSupersededError("superseded");

    await expect(adoptSupersedingPublication(owners, input, superseded)).resolves.toBe(successor);
  });

  it("rethrows the superseded error when the successor was built for different input", async () => {
    const owners = new Map<string, PreparedModelRuntimeOwner>();
    const successor = { isCurrent: () => true } as never;
    owners.set(ownerKey(input), ownerWith({ input: otherInput, snapshot: successor }));
    const superseded = new PreparedModelRuntimePublicationSupersededError("superseded");

    await expect(adoptSupersedingPublication(owners, input, superseded)).rejects.toBe(superseded);
  });
});
