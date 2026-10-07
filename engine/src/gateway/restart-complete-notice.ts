/** A chat /restart's completed notice uses the timestamp persisted before shutdown. */
export function formatChatRestartComplete(startedAt: number, completedAt = Date.now()): string {
  const elapsedSeconds = Math.max(0, (completedAt - startedAt) / 1_000);
  return `♻️ Gateway back online after ${elapsedSeconds.toFixed(1)}s.`;
}
