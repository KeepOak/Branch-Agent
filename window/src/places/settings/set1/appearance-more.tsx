// Settings › Appearance at Advanced and Technical (§4.7.3): Characters (how faces are drawn, each Trunk's look, model
// and stage background, what faces do), Pictures around Branch, Window, technical, and The list. A Trunk's model
// saves through agents.update; the small model line reads agents.defaults.utilityModel.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../../connect/engine";
import { useEffect, useState } from "react";
import { readTopicSettings, setDefaultTopicLayout, topicLayoutNames, type TopicLayout } from "../../../shell/topic-layout";
import { trunkAppearance } from "../../../face/appearance";
import { askBeforeDelete } from "../../../shell/ConfirmDelete";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, LinkBtn, Sec, Seg, Switch, useConfig, useLevel, useSaveRunner, Val } from "../kit";
import { DESKTOP, FACE_KINDS, FACE_OFF, rowOf, rowsOf } from "./appearance-rows";
import { SpecRow, type Look } from "./appearance-sections";
import type { useTrunk } from "./appearance-top";

type Trunk = ReturnType<typeof useTrunk>;
type MoreProps = { engine: WindowEngine; look: Look; trunk: Trunk; openSettings?: (page: string) => void };

export function AppearanceMore(p: MoreProps) {
  const level = useLevel();
  return (
    <>
      <TopicLayoutSec />
      {level >= 1 ? <>
      <CharactersSec {...p} />
      <PicturesSec />
      {level >= 2 ? (
        <Sec title="Window, technical" showHeading={false} group="Window">
          <Ctl title="Window frame" sub="Branch’s own title bar or the system one." off={DESKTOP}><Val>Branch’s own</Val><Btn sm>Choose</Btn></Ctl>
        </Sec>
      ) : null}
      <ListSec {...p} />
      </> : null}
    </>
  );
}

const KINDS = FACE_KINDS.map((k) => ({ id: k, label: k, ...(k === "Videos" ? {} : { off: FACE_OFF }) }));
const STAGE_BG = [["none", "None"], ["rings", "Growth rings"], ["oak", "Oak"]];

function CharactersSec({ engine, look, trunk }: MoreProps) {
  const first = trunk.agents.find((a) => a.id === trunk.defaultId) ?? trunk.agents[0];
  const still = first ? trunkAppearance(String(record(first.identity).avatar ?? "") || undefined, trunk.nameOf(first))?.still : undefined;
  return (
    <Sec title="Characters" group="The Trunk beside the conversation">
      <Ctl title="How faces are drawn" sub="Every Trunk on one stage; each kind keeps its own settings."><Seg value="Videos" options={KINDS} label="How faces are drawn" onChange={() => undefined} /></Ctl>
      <div className="r618-stage ap-k">
        {still ? <img className="stage-av-k" src={still} alt="" width={64} height={64} /> : <span className="stage-av-k" aria-hidden="true">{first ? trunk.nameOf(first).slice(0, 1) : ""}</span>}
        <small>The animated 3D videos. Still at rest; they act on events.</small>
      </div>
      <TrunkCards engine={engine} look={look} trunk={trunk} />
      <Ctl title="Bring in a character" sub="Live2D, VRM, MikuMikuDance or Spine." help="Live2D, VRM, MikuMikuDance or Spine. Checked before it joins your characters and kept for offline use." off="The engine can’t check and keep a character file yet."><Btn sm>Choose a .zip</Btn></Ctl>
      {rowsOf("Characters").map((r) => <SpecRow key={r.key} r={r} look={look} />)}
      <Ctl title="Pose by hand" sub="Pose a 3D character with a joystick or keyframes." help="Pose a 3D character and make your own moves with a joystick or keyframes." off="Needs a 3D character, and the window draws faces as videos."><Btn sm>Open the poser</Btn></Ctl>
      <Ctl title="Describe a pet" sub="An image model draws its sprite sheet." off="The engine can’t draw a pet’s sprite sheet yet."><input className="inp" placeholder="A small fox with a leaf scarf" aria-label="Describe a pet" /><Btn sm>Draw it</Btn></Ctl>
    </Sec>
  );
}

function TrunkCards({ engine, look, trunk }: Omit<MoreProps, "openSettings">) {
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
            <label><span>Look</span><select className="inp" value="Videos" aria-label={`${trunk.nameOf(a)}: look`} onChange={() => undefined}>{KINDS.map((k) => <option key={k.id} disabled={Boolean(k.off)}>{k.label}</option>)}</select></label>
            <label title="Each Trunk’s voice is chosen in Settings › Voice."><span>Voice</span><select className="inp" disabled aria-label={`${trunk.nameOf(a)}: voice`}><option>Set in Voice</option></select></label>
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
function PicturesSec() {
  return (
    <Sec title="Pictures around Branch" hint="Shown where a feature starts or has nothing to show yet." help="Shown where a feature starts or has nothing to show yet. They move gently, and hold still when motion is reduced.">
      <div className="arts17e ap-k" data-row="Pictures around Branch">
        {ART.map(([id, label]) => <figure key={id} className="art-c17e"><img src={`/assets/art17/feature/${id}.webp`} alt="" width={88} height={88} /><figcaption>{label}</figcaption></figure>)}
      </div>
    </Sec>
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

function ListSec({ engine, look, openSettings }: MoreProps) {
  const save = useSaveRunner();
  const level = useLevel();
  const cfg = useConfig(engine);
  const ask = look.val("askDelete", askBeforeDelete()) === true;
  const small = cfg.get("agents.defaults.utilityModel");
  const where = "set in Models › Sub-tasks and side jobs";
  const smallLine = small === undefined ? "Chosen by Branch (Automatic, from Models › Sub-tasks and side jobs)" : small === "" ? `None (${where})` : `${visible(small)} (${where})`;
  return (
    <Sec title="The list" group="Status bar and list">
      <Ctl title="Ask before deleting a conversation" sub="Removing a kept working copy always asks." keep="everywhere">
        <Switch checked={ask} label="Ask before deleting a conversation" onChange={(on) => void save(() => look.store.set("askDelete", on))} />
      </Ctl>
      <SpecRow r={rowOf("headlines")} look={look} />
      {level >= 2 ? (
        <dl className="kv kvline-pe18 ap-k"><dt>Small model used</dt><dd>{cfg.loading ? "Reading…" : smallLine} <LinkBtn disabled={!openSettings} onClick={() => openSettings?.("models")}>Change</LinkBtn></dd></dl>
      ) : null}
    </Sec>
  );
}
