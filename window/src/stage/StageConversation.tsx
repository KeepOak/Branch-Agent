import type { ReactNode } from "react";

/** Keeps the single conversation composer in the same column as an open stage. */
export function StageConversation({ header, thread, notice, stage, composer }: { header?: ReactNode; thread: ReactNode; notice?: ReactNode; stage?: ReactNode; composer: ReactNode }) {
  return <div className="conversation-column">
    {header}
    {thread}
    {notice}
    {stage}
    {composer}
  </div>;
}
