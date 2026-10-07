import type { ReactNode, Ref } from "react";

/** Keeps the single conversation composer in the same column as an open stage. */
export function StageConversation({ header, thread, notice, stage, pet, composer, columnRef }: { header?: ReactNode; thread: ReactNode; notice?: ReactNode; stage?: ReactNode; pet?: ReactNode; composer: ReactNode; columnRef?: Ref<HTMLDivElement> }) {
  return <div className="conversation-column" ref={columnRef}>
    {header}
    {thread}
    {notice}
    {stage}
    {pet}
    {composer}
  </div>;
}
