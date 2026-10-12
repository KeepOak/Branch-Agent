// Settings › Appearance, Advanced: how a Trunk's character sits beside the conversation (each Trunk's model and stage
// background), Pictures around Branch, and how a contact's threads and the list show. Each look change saves at once to
// the person's look (appearance-store); a Trunk's model saves through agents.update.
import { useEffect, useState } from "react";
import { readTopicSettings, setDefaultTopicLayout, topicLayoutNames, type TopicLayout } from "../../../shell/topic-layout";
import type { WindowEngine } from "../../../connect/engine";
import { trunkAppearance } from "../../../face/appearance";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Ctl, Sec, Seg, useLevel, useSaveRunner } from "../kit";
import { SpecRow, type Look } from "./appearance-sections";
import { rowOf, rowsOf } from "./appearance-rows";
import type { useTrunk } from "./appearance-top";

type Trunk = ReturnType<typeof useTrunk>;
type CharProps = { engine: WindowEngine; look: Look; trunk: Trunk };

/** The Trunk beside the conversation (Look, Advanced): its stage, each Trunk's model and background, and how it moves. */
export function CharactersSec({ engine, look, trunk }: CharProps) {
  const level = useLevel();
  if (level < 1) return null;
  const first = trunk.agents.find((a) => a.id === trunk.defaultId) ?? trunk.agents[0];
  const still = first ? trunkAppearance(String(record(first.identity).avatar ?? "") || undefined, trunk.nameOf(first))?.still : undefined;
  return (
    <Sec title="Characters" group="The Trunk beside the conversation">
      <div className="r618-stage ap-k">
        {still ? <img className="stage-av-k" src={still} alt="" width={64} height={64} /> : <span className="stage-av-k" aria-hidden="true">{first ? trunk.nameOf(first).slice(0, 1) : ""}</span>}
        <small>The animated 3D videos. Still at rest; they act on events.</small>
      </div>
      <TrunkCards engine={engine} look={look} trunk={trunk} />
      {rowsOf("Characters").map((r) => <SpecRow key={r.key} r={r} look={look} />)}
    </Sec>
  );
}

/** Pictures around Branch (Look, Advanced): the feature art shown where a feature starts or has nothing to show yet. */
export function PicturesSec() {
  const level = useLevel();
  if (level < 1) return null;
  return (
    <Sec title="Pictures around Branch" hint="Shown where a feature starts or has nothing to show yet." help="Shown where a feature starts or has nothing to show yet. They move gently, and hold still when motion is reduced.">
      <div className="arts17e ap-k" data-row="Pictures around Branch">
        {ART.map(([id, label]) => <figure key={id} className="art-c17e"><img src={`/assets/art17/feature/${id}.webp`} alt="" width={88} height={88} /><figcaption>{label}</figcaption></figure>)}
      </div>
    </Sec>
  );
}

/** How a contact's threads show and whether working rows show a headline (Layout). */
export function ListMore({ look }: { look: Look }) {
  const level = useLevel();
  return (
    <>
      <TopicLayoutSec />
      {level >= 1 ? <Sec title="The list" group="Status bar and list"><SpecRow r={rowOf("headlines")} look={look} /></Sec> : null}
    </>
  );
}

const STAGE_BG = [["none", "None"], ["rings", "Growth rings"], ["oak", "Oak"]];

/** Per-Trunk model and stage background (look key "stage:<id>"). */
function TrunkCards({ engine, look, trunk }: CharProps) {
  const save = useSaveRunner();
  const models = useResource<RecordValue>(engine, "models.list", {});
  const refs = list(models.data?.models).map((m) => ({ id: `${String(m.provider)}/${String(m.id)}`, label: visible(m.name ?? m.id) }));
  if (!trunk.agents.length) return null;
  const setModel = (id: string, v: string) => void save(async () => { await engine.request("agents.update", { agentId: id, model: v || null }); await trunk.reload(); });
  return (
    <div className="r618-chars ap-k">
      {trunk.agents.map((a) => {
        const id = String(a.id), model = String(record(a.model).primary ?? "");
        const bg = String(look.val(`stage:${id}`, "none"));
        return (
          <div key={id} className="r618-char">
            <b>{trunk.nameOf(a)}</b>
            <label><span>Model</span>
              <select className="inp" value={model} disabled={models.loading} aria-label={`${trunk.nameOf(a)}: model`} onChange={(e) => setModel(id, e.target.value)}>
                <option value="">Default</option>
                {model && !refs.some((r) => r.id === model) ? <option value={model}>{visible(model)}</option> : null}
                {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label><span>Background</span>
              <select className="inp" value={bg} aria-label={`${trunk.nameOf(a)}: background`} onChange={(e) => void save(() => look.store.set(`stage:${id}`, e.target.value === "none" ? null : e.target.value))}>
                {STAGE_BG.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        );
      })}
    </div>
  );
}

const ART = [["cloud", "A cloud computer at work"], ["call", "A phone call in progress"], ["meeting", "Joining a meeting"], ["learn", "Learning an app"], ["timeline", "A timeline replaying"]];

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
