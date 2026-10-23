import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Private #1090: managed llama.cpp must load on Gateway start so no-key-default can ask before download. */
describe("llama-cpp plugin loads for free no-key chat", () => {
  it("enables on Gateway startup like Ollama, not only after a llama-cpp account exists", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(here, "branch.plugin.json"), "utf8")) as {
      id: string;
      enabledByDefault?: boolean;
      activation?: { onStartup?: boolean };
      autoEnableWhenConfiguredProviders?: string[];
    };
    expect(manifest.id).toBe("llama-cpp");
    expect(manifest.enabledByDefault).toBe(true);
    expect(manifest.activation?.onStartup).toBe(true);
    expect(manifest.autoEnableWhenConfiguredProviders).toEqual(["llama-cpp"]);
  });
});
