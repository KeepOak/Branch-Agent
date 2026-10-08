import type { ReactNode, Ref } from "react";

/** Keeps the single conversation composer in the same column as an open stage. */
export function StageConversation({ header, topics, thread, notice, stage, pet, composer, columnRef }: { header?: ReactNode; topics?: ReactNode; thread: ReactNode; notice?: ReactNode; stage?: ReactNode; pet?: ReactNode; composer: ReactNode; columnRef?: Ref<HTMLDivElement> }) {
  return <div className="conversation-column" ref={columnRef}>
    {header}
    {topics}
    {thread}
    {notice}
    {stage}
    {pet}
    {composer}
  </div>;
}
