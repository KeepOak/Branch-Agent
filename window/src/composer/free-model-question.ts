const PLAIN_QUESTION = "Download a free model so Branch can answer without an account?";

export function plainFreeModelQuestion(step: { message?: string }): string {
  // Only extract the model fields from the engine's final question, never its recommendation.
  const question = (step.message ?? "").trim().split(/\r?\n\s*\r?\n/).at(-1) ?? "";
  // Newer engines append the whole download (model, search model and runtime); show that over the model's own size.
  const download = /^Download (.+?) \((\d+(?:\.\d+)?) GB\)(?:(?:, | and ).+runtime(?:, (\d+(?:\.\d+)?) GB in total)?, then use this model)?\?$/.exec(question);
  const cached = /(?:^|\. )Use cached (.+?)(?:, download any missing .+runtime files, then use this model\?| on Gateway host .+ with the verified CPU runtime\?)$/.exec(question);
  // Quantization belongs to the downloaded file, not the model's display name.
  const name = (download?.[1] ?? cached?.[1])
    ?.replace(/\s*\((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F(?:16|32))\)$/i, "")
    .trim();
  if (!name || /runtime|\bCUDA\b|\bCPU\b|embedding|tool calls?|llama\.cpp|\b(?:metal|vulkan|backend|gateway|host)\b|[\r\n]/i.test(name)) return PLAIN_QUESTION;
  return download
    ? `Download a free model (${name}, ${download[3] ?? download[2]} GB) so Branch can answer without an account?`
    : `Use the free model ${name} that is already on this computer so Branch can answer without an account?`;
}
