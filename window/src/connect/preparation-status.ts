/** Startup admission is temporary; keep engine/doctor wording out of the conversation. */
export function isPreparationPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /has not completed startup inspection and preparation|agent database startup preparation|prepared model runtime publication was superseded|prepared reply dispatch runtime owner was not published/i.test(message);
}

export function preparationLabel(name: string): string {
  return `Getting ${name || "this Trunk"} ready…`;
}
