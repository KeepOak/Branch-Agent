import { useLevel, type Level } from "../../places-nav/level";
import { errorWords, plainError, plainText } from "../../shell/plain-error";

/** Keep the original failure available only behind Technical Details. */
export function Failure({ error, level, notice = false }: { error: unknown; level?: Level; notice?: boolean }) {
  const savedLevel = useLevel();
  const raw = errorWords(error);
  const plain = notice ? plainText(raw, true) : plainError(error, true);
  return <>{plain}{(level ?? savedLevel) === "technical" && raw && raw !== plain ? <details><summary>Details</summary><pre>{raw}</pre></details> : null}</>;
}
