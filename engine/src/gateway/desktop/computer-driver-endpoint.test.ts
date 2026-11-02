import { afterEach, describe, expect, it } from "vitest";
import {
  computerHostEnvironment,
  DRIVER_ENDPOINT_ENV,
  DRIVER_ENDPOINT_FILE_ENV,
  driverLease,
  hasDriverEndpoint,
} from "./computer-driver-endpoint.js";

const key = Symbol.for("branch.macComputerEndpoint");
const lease = JSON.stringify({ v: 2, port: 49152, secret: "b".repeat(64) });

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[key];
});

describe("computer host driver address", () => {
  it("reads the lease the launcher keeps on its symbol, and nothing else", () => {
    expect(driverLease()).toBeUndefined();
    (globalThis as Record<symbol, unknown>)[key] = lease;
    expect(driverLease()).toBe(lease);
    (globalThis as Record<symbol, unknown>)[key] = "";
    expect(driverLease()).toBeUndefined();
  });

  it("adds the lease to the computer host environment when the Gateway's environment lacks it", () => {
    (globalThis as Record<symbol, unknown>)[key] = lease;
    const env = computerHostEnvironment({ PATH: "/usr/bin" });
    expect(env[DRIVER_ENDPOINT_ENV]).toBe(lease);
    expect(env.PATH).toBe("/usr/bin");
  });

  it("never overrides an address the environment already names", () => {
    (globalThis as Record<symbol, unknown>)[key] = lease;
    const named = { [DRIVER_ENDPOINT_ENV]: "explicit" };
    expect(computerHostEnvironment(named)).toBe(named);
    const file = { [DRIVER_ENDPOINT_FILE_ENV]: "/tmp/endpoint" };
    expect(computerHostEnvironment(file)).toBe(file);
  });

  it("returns the environment unchanged when no lease is held", () => {
    const env = { PATH: "/usr/bin" };
    expect(computerHostEnvironment(env)).toBe(env);
  });

  it("reports only whether an address is present, never its value", () => {
    expect(hasDriverEndpoint({ [DRIVER_ENDPOINT_ENV]: "secret-value" })).toBe(true);
    expect(hasDriverEndpoint({ [DRIVER_ENDPOINT_FILE_ENV]: "/x" })).toBe(true);
    expect(hasDriverEndpoint({ PATH: "/usr/bin" })).toBe(false);
  });
});
