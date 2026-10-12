import { getEncoding } from "js-tiktoken";

// tokenizer/index.js at AnythingLLM 4bff9da55539978a2a144d4cbda2cdfd87153597.
let encoder: ReturnType<typeof getEncoding> | undefined;

export function tokenizeMboxString(input = ""): number {
  const estimate = () => Math.ceil(input.length / 8) || 0;
  if (Math.floor((input.length * 2) / 1024) >= 10) return estimate();
  try {
    encoder ??= getEncoding("cl100k_base");
    return encoder.encode(input).length;
  } catch {
    return estimate();
  }
}
