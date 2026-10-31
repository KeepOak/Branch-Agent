import { useLevel, type Level } from "../../places-nav/level";
import { errorWords, plainError, plainText } from "../../shell/plain-error";

/** A failure at the person's level (#1814): Regular reads one plain sentence with a next step, Advanced and Technical
 *  read the exact words. */
export function Failure({ error, level, notice = false }: { error: unknown; level?: Level; notice?: boolean }) {
  const savedLevel = useLevel();
  const raw = errorWords(error);
  if ((level ?? savedLevel) !== "regular") return <>{raw}</>;
  return <>{notice ? plainText(raw, true) : plainError(error, true)}</>;
}
