// Settings › Appearance, Advanced: how a Trunk's character sits beside the conversation, and how a contact's threads
// and the list show. Each change saves at once to the person's look (appearance-store).
import { useEffect, useState } from "react";
import { readTopicSettings, setDefaultTopicLayout, topicLayoutNames, type TopicLayout } from "../../../shell/topic-layout";
import { Ctl, Sec, Seg, useLevel } from "../kit";
import { SpecRow, type Look } from "./appearance-sections";
import { rowOf, rowsOf } from "./appearance-rows";

type MoreProps = { look: Look };

export function AppearanceMore({ look }: MoreProps) {
  const level = useLevel();
  return (
    <>
      <TopicLayoutSec />
      {level >= 1 ? (
        <>
          <Sec title="Characters" group="The Trunk beside the conversation">
            {rowsOf("Characters").map((r) => <SpecRow key={r.key} r={r} look={look} />)}
          </Sec>
          <Sec title="The list" group="Status bar and list">
            <SpecRow r={rowOf("headlines")} look={look} />
          </Sec>
        </>
      ) : null}
    </>
  );
}

function TopicLayoutSec() {
  const [threadLayout, setThreadLayout] = useState(() => readTopicSettings().layout);
  useEffect(() => {
    const sync = () => setThreadLayout(readTopicSettings().layout);
    window.addEventListener("branch:topic-layout-changed", sync);
    const storage = (event: StorageEvent) => { if (event.key === "branch-topics-t5") sync(); };
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("branch:topic-layout-changed", sync); window.removeEventListener("storage", storage); };
  }, []);
  return <Sec title="Threads show as" group="Status bar and list"><Ctl title="Threads show as" sub="How a contact’s threads show beside its chat. A contact’s ⋯ › View can differ.">
    <Seg label="Threads show as" value={threadLayout} options={(Object.entries(topicLayoutNames) as [TopicLayout, string][]).map(([id, label]) => ({ id, label: label === "Tabs above the chat" ? "Tabs" : label }))} onChange={(next) => { setDefaultTopicLayout(next as TopicLayout); setThreadLayout(next as TopicLayout); }} />
  </Ctl></Sec>;
}
