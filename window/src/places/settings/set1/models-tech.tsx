// Settings › Models at Technical (§4.7.6): retries and timeouts, per connection, attachments, helpers, how turns
// run, each model's own parameters (agents.defaults.models.<ref>.params) and the connection details.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { visible } from "../adapter";
import { Btn, Ctl, Num, Pick, Sec, Seg, Switch, useSaveRunner } from "../kit";
import { type ModelsCtx } from "./models-data";

const NONE = "Branch has no setting for this yet.";
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function Retries({ m }: { m: ModelsCtx }) {
  return (
    <Sec title="Retries and timeouts">
      <Ctl title="Retries when a service fails" sub="A rate limit gets up to 10 tries." off={NONE}><Num label="Retries when a service fails" value={undefined} placeholder="8" onCommit={() => undefined} /></Ctl>
      <Ctl title="Wait for the first word" sub="Then it tries the next account." off={NONE}><Num label="Wait for the first word" value={undefined} placeholder="120" unit="s" onCommit={() => undefined} /></Ctl>
      <Ctl title="Model rounds per step" sub="Empty means no limit." off={NONE}><Num label="Model rounds per step" value={undefined} placeholder="None" onCommit={() => undefined} /></Ctl>
      <Ctl title="Tool and command timeout" sub="How long one command may run before it’s stopped.">
        <Num label="Tool and command timeout" min={1} value={num(m.cfg.get(["tools", "exec", "timeoutSeconds"]))} placeholder="1800" unit="s" onCommit={(v) => void m.cfg.set(["tools", "exec", "timeoutSeconds"], v)} />
      </Ctl>
      <Ctl title="Largest tool answer kept whole" sub="Sets output length from the model’s token context." help="Automatic follows the model’s room: 16,000 characters, 32,000 from 100k tokens, 64,000 from 200k, never more than 30% of it. Bigger answers are saved to a file and summarised." off={NONE}><Num label="Largest tool answer kept whole" value={undefined} placeholder="Automatic" unit="characters" onCommit={() => undefined} /></Ctl>
    </Sec>
  );
}

export function PerConnection() {
  return (
    <Sec title="Per connection" group="Per account">
      <Ctl title="Service tier" sub="Priority costs more; flex is cheaper and slower." off={NONE}><Seg label="Service tier" value="standard" options={[{ id: "standard", label: "Standard" }, { id: "priority", label: "Priority" }, { id: "flex", label: "Flex" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Slow down near a rate limit" sub="Spreads requests out instead of hitting the wall." off={NONE}><Switch checked={false} label="Slow down near a rate limit" onChange={() => undefined} /></Ctl>
      <Ctl title="Keep Claude’s cache warm" sub="Keep model caches warm during long jobs." help="A tiny request every 4 minutes during long tasks, so repeats cost less. Off until you choose: each request costs a little." off={NONE}><Switch checked={false} label="Keep Claude’s cache warm" onChange={() => undefined} /></Ctl>
      <Ctl title="Fewer rounds" sub="Groups tool calls that don’t depend on each other." off={NONE}><Switch checked label="Fewer rounds" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

export function ConnectionsTechnical({ m }: { m: ModelsCtx }) {
  const save = useSaveRunner();
  const refresh = m.cfg.get(["models", "catalogRefresh", "enabled"]);
  return (
    <Sec title="Connections, technical" group="Accounts">
      <Ctl title="Model services from plugins" sub="Add another model service through a plugin." help="A plugin can bring a way to reach a model service Branch doesn’t know yet." off={NONE}><Btn sm>See installed</Btn></Ctl>
      <Ctl title="Retired models and hiccups" sub="Try a named successor when a model is retired." help="Automatic: a retired model moves to its named successor, and a brief failure is tried again." off={NONE}><Btn sm>Last 7 days</Btn></Ctl>
      <Ctl title="Keep the model list and prices up to date" sub="Checks the public model list every few hours." help="Checks the public model list every few hours. Nothing about you is sent.">
        <Switch checked={refresh !== false} label="Keep the model list and prices up to date" onChange={(v) => void m.cfg.set(["models", "catalogRefresh", "enabled"], v)} />
      </Ctl>
      <Ctl title="Model list" sub={m.catalog.data?.refreshFailed === true ? "The last check failed. Try again." : undefined}>
        <Btn sm onClick={() => void save(async () => { await m.engine.request("models.list", { refresh: true, ...m.agent }); await m.catalog.reload(); })}>Check now</Btn>
      </Ctl>
      <Ctl title="Find free models" sub="Free models on OpenRouter, ranked for use as a fallback." help="Free models on OpenRouter, ranked for use as a fallback. Listed only. Connect OpenRouter to check each with a real call." off={NONE}><Btn sm>Look now</Btn></Ctl>
    </Sec>
  );
}

export function DecisionTechnical() {
  return (
    <Sec title="Decision models, technical" showHeading={false} group="Decision models">
      <Ctl title="Ask the big model when it’s less sure than" sub="Below this, the task’s own model decides instead." off={NONE}><Num label="Ask the big model when it’s less sure than" value={undefined} placeholder="0.75" unit="sure" onCommit={() => undefined} /></Ctl>
      <Ctl title="Longest list it filters at once" sub="Longer lists are split." off={NONE}><Num label="Longest list it filters at once" value={undefined} placeholder="400" unit="lines" onCommit={() => undefined} /></Ctl>
    </Sec>
  );
}

export function Attachments({ m }: { m: ModelsCtx }) {
  return (
    <Sec title="Attachments">
      <Ctl title="Largest file you can attach" sub="For a picture, document or other file sent in a conversation." help="For a picture, document or other file sent in a conversation. A bigger one is refused, with its size.">
        <Num label="Largest file you can attach" min={1} value={num(m.cfg.get(m.shared("mediaMaxMb")))} placeholder="Engine’s own" unit="MB" onCommit={(v) => void m.cfg.set(m.shared("mediaMaxMb"), v)} />
      </Ctl>
    </Sec>
  );
}

const SEE = [{ id: "all", label: "All" }, { id: "agent", label: "Its own Trunk’s" }, { id: "tree", label: "Its own and its helpers’" }, { id: "self", label: "Only this one" }];
export function HelpersTechnical({ m }: { m: ModelsCtx }) {
  const sub = (k: string) => m.cfg.get(m.shared("subagents", k));
  const timeout = num(sub("runTimeoutSeconds"));
  return (
    <Sec title="Helpers, technical" showHeading={false} group="Models for smaller jobs">
      <Ctl title="Conversations a Trunk can see" sub="Which conversations a Trunk’s conversation tools may reach.">
        <Seg label="Conversations a Trunk can see" value={String(m.cfg.get(["tools", "sessions", "visibility"]) ?? "all")} options={SEE} onChange={(v) => void m.cfg.set(["tools", "sessions", "visibility"], v === "all" ? null : v)} />
      </Ctl>
      <Ctl title="Helpers a task may keep open"><Num label="Helpers a task may keep open" min={1} max={20} value={num(sub("maxChildrenPerAgent"))} placeholder="5" onCommit={(v) => void m.cfg.set(m.shared("subagents", "maxChildrenPerAgent"), v)} /></Ctl>
      <Ctl title="Helper time limit" sub="0 means none.">
        <Num label="Helper time limit" value={timeout === undefined ? undefined : Math.round(timeout / 60)} placeholder="0" unit="minutes" onCommit={(v) => void m.cfg.set(m.shared("subagents", "runTimeoutSeconds"), v === null ? null : v * 60)} />
      </Ctl>
      <Ctl title="Helpers at once in a swarm" off={NONE}><Num label="Helpers at once in a swarm" value={undefined} placeholder="32" onCommit={() => undefined} /></Ctl>
    </Sec>
  );
}

export function HowTurnsRun() {
  return (
    <Sec title="How turns run">
      <Ctl title="Runs the turns" sub="Branch’s own loop unless you pick another." help="Branch’s own loop unless you pick another. Another runner still asks for your yes and keeps the record." off={NONE}><Pick label="Runs the turns" value="" options={[{ id: "", label: "Branch’s own loop" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Where turns run" sub="Turns run in the Gateway. Another computer’s Gateway runs them there." off={NONE}><Pick label="Where turns run" value="" options={[{ id: "", label: "The Gateway on this computer" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Works like" sub="Adapt prompts and tools for another agent app." help="Swaps the prompts, tools and summaries for another kind of agent app’s. /harness changes it in a conversation." off={NONE}><Pick label="Works like" value="" options={[{ id: "", label: "Branch" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Tool calls" sub="Give tools to models without native tool calling." help="Models without their own tool calling get the tools written into the prompt." off={NONE}><Pick label="Tool calls" value="" options={[{ id: "", label: "Decided for each model" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Reuse answers to the exact same request" sub="Reuse cached answers to identical requests." help="Keeps whole answers and reuses one when the very same request comes again. Answers about the time are never kept." off={NONE}><Switch checked={false} label="Reuse answers to the exact same request" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

/** Each model's own parameters, passed to its service as they are (agents.defaults.models.<ref>.params). */
export function EachModel({ m }: { m: ModelsCtx }) {
  const shown = m.models.filter((x) => x.available);
  if (!shown.length) return null;
  return (
    <Sec title="Each model, technical" group="Each model">
      {shown.map((x) => {
        const p = (k: string) => m.cfg.get(m.shared("models", x.ref, "params", k));
        const setP = (k: string, v: number | null) => void m.cfg.set(m.shared("models", x.ref, "params", k), v);
        return (
          <details key={x.ref} className="each-k">
            <summary><b>{x.name}</b><small>Context, answer length, sampling and price</small></summary>
            <Ctl id={`${x.ref} context`} title="Context" sub="Tokens it may use. Empty uses the service limit." off={NONE}><Num label={`${x.name} context`} value={undefined} placeholder="Automatic" unit="tokens" onCommit={() => undefined} /></Ctl>
            <Ctl id={`${x.ref} longest`} title="Longest answer" sub="Empty: what the service says."><Num label={`${x.name} longest answer`} min={1} value={num(p("maxTokens"))} placeholder="Automatic" unit="tokens" onCommit={(v) => setP("maxTokens", v)} /></Ctl>
            <Ctl id={`${x.ref} temperature`} title="Temperature" sub="Empty: the service default."><Num label={`${x.name} temperature`} max={2} value={num(p("temperature"))} placeholder="Default" onCommit={(v) => setP("temperature", v)} /></Ctl>
            <Ctl id={`${x.ref} seed`} title="Seed" sub="The same seed gives the same answer where the service allows." off={NONE}><Num label={`${x.name} seed`} value={undefined} placeholder="None" onCommit={() => undefined} /></Ctl>
            <Ctl id={`${x.ref} alias`} title="Its name at a gateway" sub="When a gateway calls it something else." off={NONE}><span className="val-k">{visible(x.id)}</span></Ctl>
          </details>
        );
      })}
    </Sec>
  );
}

export function PerConnectionMore() {
  const rows: [string, string, boolean][] = [
    ["Fall back on the service’s side", "Where a service can try another of its models itself.", false],
    ["Offer to go back after a reserve model", "When a task falls back to a plan’s reserve model, it remembers the first and offers it again.", true],
    ["Early access to new models", "Where a service offers it to your account. Off until you choose: early models can change.", false],
    ["Cheaper batch requests", "Work that can wait goes in a batch at a lower price.", false],
    ["Answer the same question from a saved answer", "Off until you choose: an identical request gets the earlier answer.", false],
    ["Show words per second", "While a reply is written, in the status bar.", false],
  ];
  return (
    <Sec title="Per connection, more" group="Per account" showHeading={false}>
      <Ctl title="OpenRouter picks" sub="Which provider serves an OpenRouter model." off={NONE}><Seg label="OpenRouter picks" value="default" options={[{ id: "default", label: "Its default" }, { id: "cheap", label: "Cheapest" }, { id: "fast", label: "Fastest" }]} onChange={() => undefined} /></Ctl>
      {rows.map(([t, s, on]) => <Ctl key={t} title={t} sub={s} off={NONE}><Switch checked={on} label={t} onChange={() => undefined} /></Ctl>)}
      <Ctl title="Check a model hasn’t changed" sub="Catch a model service silently changing its model." help="Asks a fixed set of questions and compares with last time, to catch a service quietly swapping the model." off={NONE}><Btn sm>Check now</Btn></Ctl>
    </Sec>
  );
}
