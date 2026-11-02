// A People failure as a person reads it: the shared Status line with its words through plainError(), so at Regular a
// failure reads as one plain sentence with a next step and at Advanced and Technical it keeps the exact words.
import { plainError } from "../../shell/plain-error";
import { Status as StatusLine } from "./ui";

export function Status({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string | null;
  reload?: () => void;
}) {
  return <StatusLine loading={loading} error={error ? plainError(error) : error} reload={reload} />;
}
