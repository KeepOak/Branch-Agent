// From AstrBotDevs/AstrBot@9d4f523464644554e0e8e50fa2a65f146e320cd1:astrbot/core/pipeline/result_decorate/stage.py (atlas VOICE-0068). Converted the trigger_probability normalization and inclusive random gate to TypeScript.

/** Preserve upstream float conversion, clamping, and the default of one. */
export function normalizeTtsTriggerProbability(value: unknown): number {
  let probability: number;
  if (typeof value === "number" || typeof value === "boolean") {
    probability = Number(value);
  } else if (typeof value === "string") {
    const number = value.trim().replace(/(?<=\d)_(?=\d)/g, "");
    if (!/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i.test(number)) {
      return 1;
    }
    probability = /^[+-]?inf(?:inity)?$/i.test(number)
      ? number.startsWith("-")
        ? -Infinity
        : Infinity
      : Number(number);
  } else {
    return 1;
  }
  // Python max(0.0, min(float("nan"), 1.0)) yields zero.
  return Number.isNaN(probability) ? 0 : Math.max(0, Math.min(probability, 1));
}

/** Upstream uses <=, including an exact zero sample at probability zero. */
export function shouldTriggerAutomaticTts(
  probability: number | undefined,
  random: () => number = Math.random,
): boolean {
  return random() <= (probability ?? 1);
}
