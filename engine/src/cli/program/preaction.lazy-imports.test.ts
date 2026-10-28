import { expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ installConfig: false, installPolicy: false }));

vi.mock("../../plugins/install-config.js", async (importOriginal) => {
  loaded.installConfig = true;
  return await importOriginal();
});
vi.mock("../plugin-install-config-policy.js", async (importOriginal) => {
  loaded.installPolicy = true;
  return await importOriginal();
});

it("keeps plugin install config IO out of the pre-action hook import graph", async () => {
  await import("./preaction.js");
  expect(loaded).toEqual({ installConfig: false, installPolicy: false });
});
