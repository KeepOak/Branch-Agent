import { describe, expect, it } from "vitest";
import { listedModels, withPrice } from "./usage-prices";

describe("model prices", () => {
  const cfg = { models: { providers: { ollama: { models: [{ id: "qwen", name: "Qwen", cost: { input: 0 } }, { id: "llama", name: "Llama" }] }, empty: {} } } };
  it("lists every model the config names, with its place", () => {
    expect(listedModels(cfg).map((r) => [r.provider, r.index, r.model.id])).toEqual([["ollama", 0, "qwen"], ["ollama", 1, "llama"]]);
  });
  it("changes one price and keeps the rest of the list", () => {
    const next = withPrice(cfg.models.providers.ollama.models, 1, "output", 2.5);
    expect(next).toEqual([{ id: "qwen", name: "Qwen", cost: { input: 0 } }, { id: "llama", name: "Llama", cost: { output: 2.5 } }]);
    expect(withPrice(next, 0, "input", null)[0]).toEqual({ id: "qwen", name: "Qwen", cost: {} });
  });
});
