import type { OutputRuntimeEnv, RuntimeEnv } from "../../runtime.js";
import { redactIdentifiersInText } from "../../security/secret-mask.js";

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactIdentifiersInText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        redactIdentifiersInText(key),
        redactValue(entry),
      ]),
    );
  }
  return value;
}

/**
 * Wraps a runtime so every line `models status` prints (text and JSON) has account
 * emails and raw token-shaped strings masked, including inside auth profile ids.
 */
export function createRedactingRuntime<T extends RuntimeEnv | OutputRuntimeEnv>(runtime: T): T {
  const wrapped: RuntimeEnv & Partial<OutputRuntimeEnv> = {
    ...runtime,
    log: (...args: unknown[]) => runtime.log(...args.map(redactValue)),
    error: (...args: unknown[]) => runtime.error(...args.map(redactValue)),
    exit: (...args: Parameters<RuntimeEnv["exit"]>) => runtime.exit(...args),
  };
  if ("writeStdout" in runtime && typeof runtime.writeStdout === "function") {
    const out = runtime as OutputRuntimeEnv;
    wrapped.writeStdout = (value: string) => out.writeStdout(redactIdentifiersInText(value));
    wrapped.writeJson = (value: unknown, space?: number) =>
      out.writeJson(redactValue(value), space);
  }
  return wrapped as T;
}
