// Settings › Voice at Advanced and Technical, in the preview's order: hearing, listening, talking, calls and
// meetings, live voice, speaking back, what Trunks may use, (Technical) live voice and voice raw rows, listening
// services, a spoken turn, calls and meetings more, (Technical) more live-voice services.
import type { SettingsPageProps } from "../index";
import type { RecordValue } from "../adapter";
import { useConfig, useLevel } from "../kit";
import { useKept, type Kept } from "./voice-kit";
import { ListeningMore, TalkingMore } from "./voice-listen";
import { CallsAndMeetings } from "./voice-calls";
import { LiveMore, LiveServices, LiveTechnical } from "./voice-live";
import { ListeningServices, SpeakingMore } from "./voice-speak";
import { VoiceTechnical } from "./voice-tech";

export type MoreProps = SettingsPageProps & { tts: Kept<RecordValue>; voices: Kept<RecordValue>; wake: Kept<RecordValue>; word: string };
export type Cfg = ReturnType<typeof useConfig>;

export function VoiceAdvanced(props: MoreProps) {
  const lv = useLevel();
  const cfg = useConfig(props.engine);
  const catalog = useKept<RecordValue>(props.engine, "talk.catalog", {});
  const agents = useKept<RecordValue>(props.engine, "agents.list", {});
  const shared = { ...props, cfg, catalog };
  return (
    <>
      <ListeningMore {...shared} />
      <TalkingMore cfg={cfg} />
      <CallsAndMeetings {...shared} />
      <LiveMore {...shared} agents={agents} />
      <SpeakingMore {...shared} />
      {lv >= 2 ? <><LiveTechnical {...shared} /><VoiceTechnical {...shared} /></> : null}
      <ListeningServices {...shared} />
      {lv >= 2 ? <LiveServices {...shared} /> : null}
    </>
  );
}
export type Shared = MoreProps & { cfg: Cfg; catalog: Kept<RecordValue> };
