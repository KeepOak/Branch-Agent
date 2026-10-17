// The quiet row under the pill (HANDOFF R1-04, preview rowP17): permission and "to …" on the left, model and reasoning
// on the right, each opening its menu above the composer. The menus' contents are the Classic composer's own
// (composer/ModeMenu, composer/ModelMenu), so every choice stays the sessions.patch it was.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WindowEngine } from "../../composer/engine";
import { modeName, type EngineMode } from "../../composer/mode";
import { capitalize, thinkingChoices, type ModelChoice } from "../../composer/model";
import { ModelMenu } from "../../composer/ModelMenu";
import { ModeMenu } from "../../composer/ModeMenu";
import { ACCOUNT_FASTER } from "../../composer/no-key-default";
import type { OpenTarget } from "../../composer/nav";
import { PlugMenu } from "../../composer/PlugMenu";
import { MenuItem, Segmented, Sep } from "../../composer/ui";
import type { useConversation } from "../../composer/useConversation";
import { currentModelAccount, useModelAccounts } from "../../composer/useModelAccount";
import { Popover } from "../../glass/Popover";
import { serviceName } from "../../places/settings/set1/service";
import type { TopicRow } from "./Composer";

/** The account a model runs on, as a person names it in the footer: its display name, never the engine's profile id
 *  (`provider:email`) or an email. Empty when the account has no plain name. */
export function footerAccount(a: { displayName?: string } | undefined): string {
  const name = a?.displayName?.trim() ?? "";
  return name && !/[@:]/.test(name) ? name : "";
}

export type RowMenu = "perm" | "tools" | "model" | "think" | "target";

type Props = {
  engine: WindowEngine;
  menu: RowMenu | null;
  setMenu: (menu: RowMenu | null) => void;
  close: () => void;
  conv: ReturnType<typeof useConversation>;
  current: ModelChoice | undefined;
  currentRef: string;
  thinking: string;
  mode: EngineMode | null;
  asSet: EngineMode | null;
  admin: boolean;
  noModel: boolean;
  trunkName: string;
  lockdown?: boolean;
  onToggleLockdown?: () => void;
  pickMode: (mode: EngineMode | null) => void;
  patch: (fields: Record<string, unknown>) => Promise<string | null>;
  onOpen: (target: OpenTarget) => void;
  onToast: (text: string) => void;
  onProblem: (text: string | null) => void;
  /** Open topics of this Trunk; empty outside its Main chat, which hides "to …". */
  topics: TopicRow[];
  target: TopicRow | null;
  onTarget: (key: string | null) => void;
};

const Chevron = () => <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>;

export function Row(p: Props) {
  const perm = useRef<HTMLButtonElement>(null), to = useRef<HTMLButtonElement>(null), model = useRef<HTMLButtonElement>(null), think = useRef<HTMLButtonElement>(null);
  const accounts = useModelAccounts(p.engine, p.conv.trunkId, false);
  const account = currentModelAccount(accounts, p.current?.provider ?? p.currentRef.split("/")[0] ?? "", p.conv.row);
  const levels = thinkingChoices(p.current);
  const level = levels.find((l) => l.id === p.thinking);
  const permission = p.lockdown ? "Lockdown" : modeName(p.mode ?? p.asSet) || "As set";
  const toggle = (menu: RowMenu) => p.setMenu(p.menu === menu ? null : menu);
  // Narrow docks scroll the row; the right-edge mask shows only while something is out of view (size only, never DOM writes).
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const node = strip.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { const node = strip.current; if (node) setOverflow(node.scrollWidth > node.clientWidth + 1); });
  const open = (target: OpenTarget) => { p.close(); p.onOpen(target); };
  return <div ref={strip} className="r1c-row" data-overflow={overflow || undefined}>
    <button ref={perm} type="button" className="r1c-quiet" data-local="" data-tone={p.lockdown || (p.mode ?? p.asSet) === "full" ? "bad" : undefined} aria-haspopup="menu" aria-expanded={p.menu === "perm"} title="How much it may do here (Shift+Tab)" onClick={() => toggle("perm")}>{permission}<Chevron /></button>
    {p.topics.length ? <button ref={to} type="button" className="r1c-quiet r1c-to" data-local="" aria-haspopup="menu" aria-expanded={p.menu === "target"} title="Which topic gets this message" onClick={() => toggle("target")}>to {p.target?.title ?? "Main chat"}<Chevron /></button> : null}
    <span className="r1c-grow" />
    {p.noModel
      ? (p.conv.noKeySettled && !p.conv.noKeyError
        ? <button type="button" className="r1c-quiet" data-local="" onClick={() => p.onOpen("settings/accounts/add")}>Connect a model</button>
        : <button type="button" className="r1c-quiet" data-local="" title={ACCOUNT_FASTER} onClick={() => p.onOpen("settings/accounts/add")}>Smarter with an account</button>)
      : <button ref={model} type="button" className="r1c-quiet" data-local="" aria-haspopup="menu" aria-expanded={p.menu === "model"} title="Which model answers" onClick={() => toggle("model")}>{p.current?.name ?? (p.conv.modelsLoaded ? "No model" : "Model")}</button>}
    {!p.noModel && levels.length ? <button ref={think} type="button" className="r1c-quiet" data-local="" aria-haspopup="menu" aria-expanded={p.menu === "think"} title="How hard it thinks" onClick={() => toggle("think")}>{capitalize(level?.label ?? p.thinking) || "Thinking"}</button> : null}

    {p.menu === "perm" ? <Menu anchor={perm} label="How much may it do in this conversation?" onClose={p.close} width={340}>
      <ModeMenu embedded anchor={perm} onClose={p.close} mode={p.mode} asSet={p.asSet} canSelectFull={p.admin} lockdown={p.lockdown} onToggleLockdown={p.onToggleLockdown}
        onPick={p.pickMode} onOpen={open} row={p.conv.row} onElevated={(value) => void p.patch({ elevatedLevel: value })} />
      <Sep />
      <MenuItem icon="plug" label="Tools for this conversation…" onClick={() => p.setMenu("tools")} />
    </Menu> : null}
    {p.menu === "tools" ? <PlugMenu anchor={perm} onClose={p.close} engine={p.engine} row={p.conv.row} trunkName={p.trunkName} isAdmin={p.admin} patch={p.patch} onToast={p.onToast} onOpen={open} surface="r1c-plugpop" /> : null}
    {p.menu === "target" ? <Menu anchor={to} label="Send to" onClose={p.close} width={280}>
      <div className="c-pt">Send to</div>
      <MenuItem tick label="Main chat" checked={!p.target} onClick={() => p.onTarget(null)} />
      {p.topics.map((t) => <MenuItem key={t.key} tick label={t.title} checked={p.target?.key === t.key} onClick={() => p.onTarget(t.key)} />)}
    </Menu> : null}
    {p.menu === "model" ? <Menu anchor={model} label="Which model answers" onClose={p.close} width={330} align="end" extra="r1c-model">
      <ModelMenu embedded anchor={model} onClose={p.close} models={p.conv.models} loading={p.conv.modelsLoading} error={p.conv.modelsError} current={p.current} currentRef={p.current?.ref ?? p.currentRef}
        row={p.conv.row} thinking={p.thinking} trunkName={p.trunkName} isAdmin={p.admin} patch={async (fields) => void (await p.patch(fields))}
        onKeepForTrunk={async (m) => {
          try { await p.engine.request("agents.update", { agentId: p.conv.trunkId, model: m.ref }); await p.conv.reload(); p.onToast(`${p.trunkName} uses ${m.name} from now on.`); }
          catch (error) { p.onProblem(error instanceof Error ? error.message : String(error)); }
        }} onOpen={open} onRetry={() => void p.conv.readModelList()} engine={p.engine} trunkId={p.conv.trunkId} />
      <Sep />
      <MenuItem icon="users" label="Accounts and order…" onClick={() => open("settings/accounts")} />
      <MenuItem icon="sliders" label="Manage models…" onClick={() => open("settings/models")} />
      <div className="r1c-runs"><i aria-hidden="true" /><span>Runs on <b>{p.current?.local ? "this computer" : p.current ? serviceName(p.current.provider) : "no model"}{footerAccount(account?.a) ? ` · ${footerAccount(account?.a)}` : ""}</b></span>
        <button type="button" className="r1c-chip" onClick={() => open("settings/accounts")}>Change</button></div>
    </Menu> : null}
    {p.menu === "think" ? <Menu anchor={think} label="How hard it thinks" onClose={p.close} width={300} align="end">
      <div className="c-pt">How hard it thinks</div>
      <div className="r1c-seg"><Segmented label="How hard it thinks" items={levels.map((l) => ({ id: l.id, label: capitalize(l.label) }))} value={p.thinking} onPick={(id) => void p.patch({ thinkingLevel: id })} /></div>
      <p className="c-pp">Higher thinks longer and uses your plan faster.</p>
    </Menu> : null}
  </div>;
}

/** A row menu: floating glass above the composer, placed by the one glass positioner. */
function Menu({ anchor, label, onClose, width, align = "start", extra = "", children }: { anchor: RefObject<HTMLElement | null>; label: string; onClose: () => void; width: number; align?: "start" | "end"; extra?: string; children: React.ReactNode }) {
  return <Popover anchor={anchor} label={label} onClose={onClose} width={width} align={align} placement="above"><div className={`r1c-menu ${extra}`}>{children}</div></Popover>;
}
