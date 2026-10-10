// Settings › Models, Advanced and Technical (§4.7.6): the sections every tab shares, in the preview's order, with
// each tab's own sections in their place. Wired rows save to the engine config; rows the engine has no setting
// for are greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { ReactNode } from "react";
import { list, text, visible } from "../adapter";
import { Btn, Ctl, Num, Pick, Sec, Seg, Switch, useLevel, useSaveRunner, type Opt } from "../kit";
import { modelOpts, refOf, type ModelsCtx } from "./models-data";
import { FallbackLists, HowTrunksWork, NewConversations, Nicknames } from "./models-defaults";
import { LocalMore, MediaMore, SecondMore } from "./models-tabs";
import { Attachments, ConnectionsTechnical, DecisionTechnical, EachModel, HelpersTechnical, HowTurnsRun, PerConnection, PerConnectionMore, Retries } from "./models-tech";

export const NONE = "Branch has no setting for this yet.";
const MODEL_CHOICE_ENABLED = ["tools", "modelChoice", "enabled"];
const MODEL_CHOICE_PER_TASK = ["tools", "modelChoice", "perTask"];

/** Every Advanced/Technical section, in the order the preview shows them for this tab. */
export function ModelsSections({ m, tab, openSettings }: { m: ModelsCtx; tab: string; openSettings?: (page: string) => void }) {
  const t = useLevel() >= 2;
  const parts: [boolean, ReactNode][] = [
    [tab === "local", <LocalMore key="fit" openSettings={openSettings} />],
    [true, <Budgets key="budgets" m={m} />],
    [true, <SmallerJobs key="smaller" m={m} />],
    [true, <CompareModels key="compare" />],
    [t, <Retries key="retries" m={m} />],
    [t, <PerConnection key="perconn" />],
    [t, <PerConnectionMore key="perconnmore" />],
    [true, <Mixtures key="mix" />],
    [tab === "second", <SecondMore key="second" />],
    [t && tab === "media", <MediaMore key="media" />],
    [t && tab === "connections", <ConnectionsTechnical key="conntech" m={m} />],
    [tab === "defaults", <HowTrunksWork key="how" />],
    [true, <DecisionModels key="decide" m={m} />],
    [t, <DecisionTechnical key="decidet" />],
    [t, <Attachments key="attach" m={m} />],
    [t, <HelpersTechnical key="helpers" m={m} />],
    [tab === "defaults", <NewConversations key="new" m={m} />],
    [tab === "defaults", <FallbackLists key="fails" m={m} />],
    [t && tab === "defaults", <Nicknames key="nick" m={m} />],
    [t, <HowTurnsRun key="turns" />],
    [true, <PicturesVideoMusic key="pics" m={m} />],
    [true, <FinishingWell key="finish" />],
    [true, <PickingModels key="picking" m={m} />],
    [true, <ModelJobs key="jobs" m={m} />],
    [t, <EachModel key="each" m={m} />],
  ];
  return <>{parts.filter(([on]) => on).map(([, node]) => node)}</>;
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function Budgets({ m }: { m: ModelsCtx }) {
  const sub = (k: string) => m.cfg.get(m.shared("subagents", k));
  const a2a = m.cfg.get(["tools", "agentToAgent", "enabled"]);
  return (
    <Sec title="Budgets">
      <Ctl title="Most steps in one task" sub="Empty means no limit. When set, it stops and asks when it gets there." off={NONE}><Num label="Most steps in one task" value={undefined} unit="steps" placeholder="None" onCommit={() => undefined} /></Ctl>
      <Ctl title="Spend cap per task" sub="Empty means no cap. Only for accounts that bill per use." off={NONE}><Num label="Spend cap per task" value={undefined} unit="USD" placeholder="None" onCommit={() => undefined} /></Ctl>
      <Ctl title="Sub-tasks at once" sub="Parts of a big task that can run side by side."><Num label="Sub-tasks at once" min={1} value={num(sub("maxConcurrent"))} placeholder="8" onCommit={(v) => void m.cfg.set(m.shared("subagents", "maxConcurrent"), v)} /></Ctl>
      <Ctl title="Trunks may start their own Trunks" sub="How deep Trunks can nest. 1 means a Trunk can’t start another."><Num label="Trunks may start their own Trunks" min={1} max={5} value={num(sub("maxSpawnDepth"))} placeholder="5" unit="levels" onCommit={(v) => void m.cfg.set(m.shared("subagents", "maxSpawnDepth"), v)} /></Ctl>
      <Ctl title="Trunks may reach each other’s conversations" sub="A Trunk can read and message another Trunk’s conversations." help="A Trunk can read and message another Trunk’s conversations. Who may talk to whom is in each Trunk’s Who it knows.">
        <Switch checked={a2a !== false} label="Trunks may reach each other’s conversations" onChange={(v) => void m.cfg.set(["tools", "agentToAgent", "enabled"], v)} />
      </Ctl>
    </Sec>
  );
}

function SmallerJobs({ m }: { m: ModelsCtx }) {
  const save = useSaveRunner();
  const side = refOf(m.ownOrShared("subagents", "model"));
  const utility = refOf(m.ownOrShared("utilityModel"));
  return (
    <Sec title="Models for smaller jobs">
      <Ctl title="Sub-tasks and side jobs" sub="Titles, summaries and searches inside a task.">
        <Pick label="Sub-tasks and side jobs" value={side} options={[{ id: "", label: "Automatic" }, ...modelOpts(m.models)]} onChange={(v) => void m.cfg.set(m.own("subagents", "model"), v || null)} />
      </Ctl>
      <Ctl title="Pick the model per task" sub="A Trunk may choose the model when it starts a task.">
        <Switch checked={m.cfg.get(MODEL_CHOICE_PER_TASK) !== false} label="Pick the model per task" onChange={(v) => void m.cfg.set(MODEL_CHOICE_PER_TASK, v)} />
      </Ctl>
      <Ctl title="Planning model" sub="Writes the plan in Plan first." off={NONE}><Pick label="Planning model" value="" options={[{ id: "", label: "Same model" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Mix models on hard questions" sub="Asks two and merges the best of each." help="Asks two and merges the best of each. Off until you choose: it doubles the cost." off={NONE}><Switch checked={false} label="Mix models on hard questions" onChange={() => undefined} /></Ctl>
      <Ctl title="Live summaries of long tasks" sub="Uses the model for smaller jobs." help="Uses the model for smaller jobs. On an account that bills per use, each summary costs a little." off={NONE}><Switch checked label="Live summaries of long tasks" onChange={() => undefined} /></Ctl>
      <Ctl title="Setup Trunk" sub={utility ? `${m.models.find((x) => x.ref === utility)?.name ?? visible(utility)} helps set Branch up and does small jobs. Conversations need a main model.` : "It helps set Branch up and does small jobs. Conversations need a main model."}>
        <Btn sm onClick={() => void save(async () => { const r = (await m.engine.request("branch.setup.verify", { modelTarget: "utility", ...m.agent })) as { ok?: boolean; error?: string }; if (r.ok === false) throw new Error(visible(r.error ?? "The setup Trunk didn’t answer.")); })}>Check again</Btn>
      </Ctl>
    </Sec>
  );
}

function CompareModels() {
  return (
    <Sec title="Compare models">
      <Ctl title="Model arena" sub="The same task to two models, you pick the better." help="The same task to two models, you pick the better. Ratings build up over time." off={NONE}><Btn sm>Open the arena</Btn></Ctl>
      <Ctl title="Test suites" sub="Your own tasks with a check for each, with history." off={NONE}><Btn sm>See history</Btn></Ctl>
    </Sec>
  );
}

function Mixtures() {
  return (
    <Sec title="Mixtures and savings">
      <Ctl title="See what it saved" sub="See round-by-round model and cache figures." help="Round-by-round figures for fewer rounds, the cache and mixing models on hard questions." off={NONE}><Btn sm>See the savings</Btn></Ctl>
      <Ctl title="Private things stay here" sub="Keep private work on this computer’s model." help="Anything marked private, and the Home project, only go to the model on this computer." off={NONE}><Btn sm>See what stays</Btn></Ctl>
      <Ctl title="Sure-or-not checks" sub="Ask a stronger model when a small check is uncertain." help="Small yes-or-no checks inside a task come with a confidence; a low one asks a better model." off={NONE}><Btn sm>Show one</Btn></Ctl>
    </Sec>
  );
}

/** Decision models: agents.defaults.decisionModel ("" = none), from the engine's decision model list. */
function DecisionModels({ m }: { m: ModelsCtx }) {
  const value = String(m.ownOrShared("decisionModel") ?? "");
  const opts: Opt[] = [{ id: "", label: "None" }, ...m.decisionModels.map((d) => ({ id: `${text(d.provider)}/${text(d.id)}`, label: visible(d.name) })), ...modelOpts(m.models)];
  return (
    <Sec title="Decision models" hint="Use small, fast models for easy judgments." help="Small, fast judgments: yes or no, pick one, a score, or keep-or-drop over a list. Branch uses them to send a message to the right Trunk and to sort the Inbox, so the big model isn’t woken for easy calls.">
      <Ctl title="Model for decisions" sub="None until you choose one." help="None until you choose one. A model on this computer is free, and nothing leaves.">
        <Pick label="Model for decisions" value={value} options={opts} onChange={(v) => void m.cfg.set(m.own("decisionModel"), v || null)} />
      </Ctl>
      <Ctl title="Send each message to the right Trunk" sub="When you don’t say who, it picks from their jobs." off={NONE}><Switch checked={false} label="Send each message to the right Trunk" onChange={() => undefined} /></Ctl>
      <Ctl title="Sort the Inbox by urgency" sub="Deadlines and money first." off={NONE}><Switch checked={false} label="Sort the Inbox by urgency" onChange={() => undefined} /></Ctl>
      <Ctl title="Filter long lists before a Trunk reads them" sub="Mail, files and search results it clearly doesn’t need are dropped." off={NONE}><Switch checked={false} label="Filter long lists before a Trunk reads them" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

function PicturesVideoMusic({ m }: { m: ModelsCtx }) {
  const media = (kind: string) => refOf(m.cfg.get(m.shared("mediaModels", kind)));
  const auto = [{ id: "", label: "Automatic: the first one that works" }];
  const pick = (kind: string, label: string) => {
    const v = media(kind);
    return <Pick label={label} value={v} options={[...auto, ...(v ? [{ id: v, label: visible(v) }] : [])]} onChange={(x) => void m.cfg.set(m.shared("mediaModels", kind, "primary"), x || null)} />;
  };
  return (
    <Sec title="Pictures, video and music">
      <Ctl title="Pictures with" sub="Making and editing pictures." help="Making and editing pictures. Picks need their service connected in Accounts or Saved passwords.">{pick("image", "Pictures with")}</Ctl>
      <Ctl title="Video with" sub="Video from words, a picture or another video.">{pick("video", "Video with")}</Ctl>
      <Ctl title="Music with" sub="Songs and instrumentals from a style and a mood.">{pick("music", "Music with")}</Ctl>
      <Ctl title="Fill out the picture prompt first" sub="A model turns your words and the conversation into a detailed prompt." help="A model turns your words and the conversation into a detailed prompt. You can read it under each picture." off={NONE}><Switch checked label="Fill out the picture prompt first" onChange={() => undefined} /></Ctl>
      <Ctl title="Make pictures bigger afterwards" sub="An extra pass that enlarges each picture." help="An extra pass that enlarges each picture. It takes longer and costs more." off={NONE}><Switch checked={false} label="Make pictures bigger afterwards" onChange={() => undefined} /></Ctl>
      <Ctl title="Shrink pictures before sending" sub="Reduce large photos before sending them to a model." help="Large photos are made smaller before they go to the model, to save words and time. Your original is kept.">
        <Switch checked={m.cfg.get(m.shared("imageQuality")) !== "high"} label="Shrink pictures before sending" onChange={(v) => void m.cfg.set(m.shared("imageQuality"), v ? null : "high")} />
      </Ctl>
      <Ctl title="Reads pictures, video and sound" sub="Describe images with another model when needed." help="When the model in use can’t see, another model describes what you attached in words first.">
        <Pick label="Reads pictures, video and sound" value={refOf(m.cfg.get(m.shared("imageModel")))} options={[{ id: "", label: "The model in use, when it can" }, ...modelOpts(m.models, (x) => x.images)]} onChange={(v) => void m.cfg.set(m.shared("imageModel", "primary"), v || null)} />
      </Ctl>
      <Ctl title="Read text in pictures with" sub="For photos of text and scanned pages." off={NONE}><Pick label="Read text in pictures with" value="" options={[{ id: "", label: "This computer’s own" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Turn documents into text with" sub="Turn office files into Markdown before model reading." help="PDFs, Word, Excel and slides become Markdown before the model reads them." off={NONE}><Pick label="Turn documents into text with" value="" options={[{ id: "", label: "Branch’s own reader" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Send PDFs to the model as they are" sub="Send PDFs whole when the model supports documents." help="When the model takes documents, the PDF goes whole, pictures included; otherwise as text." off={NONE}><Switch checked label="Send PDFs to the model as they are" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

const FINISH: [string, string, boolean][] = [
  ["Check the work before saying done", "Its checks run against what it actually did, not what it said. After editing code, the tests run again first.", true],
  ["A second model reviews the result", "A reviewer scores the work and sends it back with notes when it falls short.", false],
  ["Ask a stronger model for advice when it’s stuck", "When it repeats itself or stops making progress, a stronger model looks at the steps and suggests a way out.", true],
  ["Try several answers and keep the best", "At hard points it makes a few answers, checks each one (running the tests, say) and keeps the one that does best. Costs more.", false],
  ["Keep going while the plan has unticked steps", "If it stops with steps left, it’s reminded to carry on, unless you stopped it or it’s waiting for you.", true],
];
function FinishingWell() {
  return (
    <Sec title="Finishing well">
      {FINISH.map(([t, s, on]) => <Ctl key={t} title={t} sub={s} off={NONE}><Switch checked={on} label={t} onChange={() => undefined} /></Ctl>)}
      <Ctl title="When a goal is met" sub="What happens after /goal is done." off={NONE}><Seg label="When a goal is met" value="stop" options={[{ id: "stop", label: "Stop" }, { id: "suggest", label: "Suggest the next" }, { id: "start", label: "Start the next" }]} onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

const PICKING: [string, string, boolean][] = [
  ["Ask before a costly model", "Switching to a model that costs much more asks first.", true],
  ["Hide models that learn from what you send", "Some cheap plans train on your messages; they’re left out of every menu.", false],
  ["Offer newer models", "Once, when a newer model replaces the one you use.", true],
  ["Warn about models not made for tasks", "A small note when a picked model is weak at using tools.", true],
];
function PickingModels({ m }: { m: ModelsCtx }) {
  const allow = list(m.cfg.get(m.shared("modelPolicy", "allow")) as unknown[]).length;
  return (
    <Sec title="Picking models">
      <Ctl title="Favourite models" sub="Show starred and recent models first." help="Starred models come first in the model menu, with the ones you used last." off={NONE} />
      <Ctl title="Model setups" sub="Save a mix of model, account and settings." help="A named mix of model, account and settings you can switch to in one go, or hand to a Trunk." off={NONE}><Btn sm>Save the current one</Btn></Ctl>
      <Ctl title="Model in Auto" sub="Each mode can keep its own model." off={NONE}><Pick label="Model in Auto" value="" options={[{ id: "", label: "Same model" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Model in Plan first" off={NONE}><Pick label="Model in Plan first" value="" options={[{ id: "", label: "Same model" }]} onChange={() => undefined} /></Ctl>
      {PICKING.map(([t, s, on]) => <Ctl key={t} title={t} sub={s} off={NONE}><Switch checked={on} label={t} onChange={() => undefined} /></Ctl>)}
      <Ctl title="Trunks may switch their own model" sub="A Trunk can change its own model. Without Full access it asks you first." help="A Trunk can change its own model or sign-in. With Full access the change happens straight away; without it you get one approve card, and nothing changes until you allow it.">
        <Switch checked={m.cfg.get(MODEL_CHOICE_ENABLED) === true} label="Trunks may switch their own model" onChange={(v) => void m.cfg.set(MODEL_CHOICE_ENABLED, v)} />
      </Ctl>
      <Ctl title="Where models run" sub={allow ? `Only the ${allow} allowed models can be picked.` : "This computer first falls back to a service when it can’t answer."} off={NONE}>
        <Seg label="Where models run" value="services" options={[{ id: "services", label: "Services first" }, { id: "local", label: "This computer first" }, { id: "only", label: "Only this computer" }]} onChange={() => undefined} />
      </Ctl>
      <Ctl title="Pictures go to a model that sees" sub="Describe pictures for models that cannot see them." help="A model that can’t see pictures gets the words; the picture goes to one that can." off={NONE}><Switch checked label="Pictures go to a model that sees" onChange={() => undefined} /></Ctl>
      <Ctl title="Each kind of step picks its own model" sub="Use different models for searching, reading and writing." help="Searching, reading and writing can use different models from the one planning." off={NONE}><Switch checked={false} label="Each kind of step picks its own model" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

function ModelJobs({ m }: { m: ModelsCtx }) {
  return (
    <Sec title="Model jobs">
      <Ctl title="Looking at pictures" sub="Used when the main model can’t see.">
        <Pick label="Looking at pictures" value={refOf(m.cfg.get(m.shared("imageModel")))} options={[{ id: "", label: "Automatic" }, ...modelOpts(m.models, (x) => x.images)]} onChange={(v) => void m.cfg.set(m.shared("imageModel", "primary"), v || null)} />
      </Ctl>
      <Ctl title="Finding things on the screen" sub="For using the computer: a model good at pointing." off={NONE}><Pick label="Finding things on the screen" value="" options={[{ id: "", label: "Automatic" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Applying a plan’s edits" sub="One model plans, another writes the changes." off={NONE}><Pick label="Applying a plan’s edits" value="" options={[{ id: "", label: "Same model" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Summaries" sub="Keeping long conversations short.">
        <Pick label="Model for summaries" value={String(m.cfg.get(m.shared("compaction", "model")) ?? "")} options={[{ id: "", label: "Model for smaller jobs" }, ...modelOpts(m.models)]} onChange={(v) => void m.cfg.set(m.shared("compaction", "model"), v || null)} />
      </Ctl>
      <Ctl title="Routers" sub="Pick a model for each job based on its strengths." help="A list of models, each with a line about what it’s good at; the router picks one per task." off={NONE}><Btn sm>Add a router</Btn></Ctl>
    </Sec>
  );
}
