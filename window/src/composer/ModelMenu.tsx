// The model menu (DESIGN-SPEC §4.3.4 and its Parity adds): which model answers here, how long it thinks, its speed,
// its room to plan, and what is shown here. Every choice is a sessions.patch on this conversation, read back after.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useRef, useState, type RefObject } from "react";
import { str, type Rec } from "./engine";
import { accountLine, capitalize, groupModels, thinkingChoices, type ModelChoice } from "./model";
import { ModelAccessInfo } from "./ModelAccessInfo";
import type { AvailabilityReason } from "./model-capabilities";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { Popover, moveFocus } from "./Popover";
import { Head, MenuItem, Segmented, Sep } from "./ui";
import { Icon, type IconName } from "./icons";
import { Logo, serviceName as brandName } from "../places/settings/set1/service";
import { accountName, type Account } from "../places/settings/set1/accounts";
import { shows, useLevel } from "../places-nav/level";
import type { WindowEngine } from "./engine";
import { NOT_ON_PLAN, offPlan, planOrder, runsOnCodex, useCodexPlan } from "./codex-plan";
import { currentModelAccount, useModelAccounts } from "./useModelAccount";

type Props = {
  embedded?: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  models: ModelChoice[];
  loading: boolean;
  error: string | null;
  current: ModelChoice | undefined;
  currentRef: string;
  row: Rec;
  thinking: string;
  trunkName: string;
  isAdmin: boolean;
  patch: (fields: Record<string, unknown>) => Promise<void>;
  onKeepForTrunk: (m: ModelChoice) => Promise<void>;
  onOpen?: (target: OpenTarget) => void;
  onRetry: () => void;
  /** Reads the current service's accounts (models.authStatus) for the Account group and the fallback line. */
  engine?: WindowEngine;
  /** The conversation's Trunk, whose ChatGPT plan (codex.models) says which Codex models it can run. */
  trunkId?: string;
};


const accountsFor = (all: Account[], provider: string | undefined) => (provider ? all.filter((a) => a.p.provider === provider || a.p.authProvider === provider) : []);
const UNAVAILABLE_LABELS: Record<AvailabilityReason, string> = {
  "missing-auth": "sign-in needed", "auth-failed": "sign-in needs attention",
  cooldown: "resting after a limit", "unsupported-runtime": "runtime unavailable",
};

/** The line under a model: its selected account by name, else its service. */
function modelLine(m: ModelChoice, all: Account[], row: Rec): string {
  if (m.local) return accountLine(m);
  const first = currentModelAccount(all, m.provider, row);
  const line = first ? accountName(first) : brandName(m.provider);
  const reason = m.runtimeMetadata?.unavailableReason;
  return m.available ? line : `${line} · ${reason ? UNAVAILABLE_LABELS[reason] : "unavailable"}`;
}

const SPEEDS = [
  { id: "standard", label: "Standard" },
  { id: "fast", label: "Fast" },
];
const STEPS = [
  { id: "as-set", label: "As set" },
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
  { id: "full", label: "Full" },
];
const THINKING_TEXT = [
  { id: "as-set", label: "As set" },
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
  { id: "stream", label: "Live" },
];

function speedOf(row: Rec): string {
  const v = row.fastMode ?? row.effectiveFastMode;
  return v === true || v === "auto" ? "fast" : v === "ultrafast" ? "ultrafast" : "standard";
}

export function ModelMenu(p: Props) {
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const locked = p.row.modelSelectionLocked === true;
  const shown = locked ? p.models.filter((m) => m.ref === p.currentRef) : p.models;
  const groups = groupModels(shown, query);
  const advanced = shows(useLevel(), "advanced");
  const allAccounts = useModelAccounts(p.engine, p.trunkId ?? "", false);
  const plan = useCodexPlan(p.engine, p.trunkId, p.models.some(runsOnCodex));
  const accounts = accountsFor(allAccounts, p.current?.provider);
  const levels = thinkingChoices(p.current);
  const speeds = p.current?.serviceTiers.includes("ultrafast") ? [...SPEEDS, { id: "ultrafast", label: "Ultrafast" }] : SPEEDS;
  const open = (target: OpenTarget) => {
    p.onClose();
    p.onOpen?.(target);
  };
  const content = (
      <div
        ref={body}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(body.current, e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <label className="c-search">
          <Icon name="search" size={15} />
          <input autoFocus placeholder="Search models" aria-label="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {locked ? <p className="c-pp">The model here is fixed.</p> : null}
        {p.loading && p.models.length === 0 ? <p className="c-pp">Loading models…</p> : null}
        {p.error ? (
          <p className="c-pp bad">
            {p.error} <button type="button" className="c-link" onClick={p.onRetry}>Try again</button>
          </p>
        ) : null}
        {!p.loading && !p.error && p.models.length === 0 ? (
          allAccounts.length > 0 ? <p className="c-pp">No models are allowed here.</p> : (
            <p className="c-pp">
              No model account connected yet.{" "}
              <button type="button" className="c-link" disabled={!p.onOpen} title={p.onOpen ? undefined : NO_ROUTE} onClick={() => open("settings/accounts/add")}>Add an account</button>
            </p>
          )
        ) : null}
        {p.models.length > 0 && groups.length === 0 ? <p className="c-pp">No models match.</p> : null}
        <div className="c-scroll">
          {groups.map((g) => (
            <div key={g.service} role="group" aria-label={g.service}>
              <div className="c-grp">{g.models[0]?.local ? g.service : brandName(g.service)}</div>
              {planOrder(g.models, plan).map((m) => { const off = offPlan(m, plan); return (
                <MenuItem
                  key={m.ref}
                  testId="model-option"
                  tick
                  lead={<Logo id={m.provider} size={22} />}
                  label={<span className="c-modelname">{m.name}{m.supportsTools ? null : <span className="c-pill" title="It can chat, but it can't use tools. Pick another model for files, commands, the web or media.">Chat only</span>}</span>}
                  sub={modelLine(m, allAccounts, p.row)}
                  checked={m.ref === p.currentRef}
                  disabled={locked || off}
                  reason={off ? NOT_ON_PLAN : undefined}
                  reasonLine={off}
                  onClick={() => void p.patch({ model: m.ref, thinkingLevel: null })}
                />
              ); })}
            </div>
          ))}
        </div>
        {advanced && p.current && p.current.ref !== "" ? (
          <>
            <MenuItem
              icon="users"
              label={`Use ${p.current.name} for ${p.trunkName} from now on`}
              disabled={!p.isAdmin}
              reason={p.isAdmin ? undefined : "This needs admin access on this computer."}
              onClick={() => void p.onKeepForTrunk(p.current as ModelChoice)}
            />
            <LinkRow icon="gear" label={`Use ${p.current.name} everywhere from now on…`} target="settings/models" onOpen={p.onOpen} open={open} />
          </>
        ) : null}
        {advanced && accounts.length > 1 ? (
          <>
            <Sep />
            <Head>Account</Head>
            <MenuItem label="Automatic" sub="Branch picks, and moves on when one runs low" checked />
            <LinkRow icon="users" label="Manage accounts…" target="settings/accounts" onOpen={p.onOpen} open={open} />
          </>
        ) : null}
        <Sep />
        <ModelSettings {...p} levels={levels} speeds={speeds} advanced={advanced} />
        {!p.embedded ? <ModelAccessInfo model={p.current} /> : null}
        {!p.embedded ? <p className="c-pp c-pp-end">
          Thinking options depend on the model.
          {accounts.length > 1 ? ` When ${accountName(accounts[0])} runs out, Branch moves to ${accountName(accounts[1])}.` : ""}
        </p> : null}
        {!p.embedded ? <LinkRow icon="sliders" label="Manage models…" target="settings/models" onOpen={p.onOpen} open={open} /> : null}
      </div>
  );
  return p.embedded ? content : <Popover anchor={p.anchor} onClose={p.onClose} label="Model and how long it thinks" className="c-model">{content}</Popover>;
}

function ModelSettings(p: Props & { levels: { id: string; label: string }[]; speeds: { id: string; label: string }[]; advanced: boolean }) {
  const ctx = p.current?.contextWindows ?? [];
  return (
    <div className="c-settings">
      {p.levels.length > 0 ? (
        <div className="c-row">
          <span>Thinking</span>
          <Segmented
            label="Thinking"
            items={p.levels.map((l) => ({ id: l.id, label: capitalize(l.label) }))}
            value={p.thinking}
            onPick={(id) => void p.patch({ thinkingLevel: id })}
          />
        </div>
      ) : null}
      {p.current ? (
        <>
      <div className="c-row">
        <span>Speed</span>
        <Segmented
          label="Speed"
          items={p.speeds}
          value={speedOf(p.row)}
          disabled={!p.current.supportsFastMode}
          reason={p.current.supportsFastMode ? undefined : "This model has one speed."}
          onPick={(id) => void p.patch({ fastMode: id === "standard" ? false : id === "fast" ? true : "ultrafast" })}
        />
      </div>
      <p className="c-pp c-pp-note">{p.current.supportsFastMode ? "Faster answers use your plan’s limits faster." : "This model has one speed."}</p>
        </>
      ) : null}
      {p.advanced && ctx.length > 1 ? (
        <div className="c-row">
          <span>Context to plan for</span>
          <Segmented
            label="Context to plan for"
            items={ctx}
            value={str(p.row.contextWindow) || p.current?.contextWindowDefault || ""}
            onPick={(id) => void p.patch({ contextWindow: id })}
          />
        </div>
      ) : null}
      {p.advanced ? (
        <>
      <Head>Show here</Head>
      <div className="c-row">
        <span>Steps sent as messages</span>
        <Segmented label="Steps sent as messages" items={STEPS} value={str(p.row.verboseLevel) || "as-set"} disabled={!p.isAdmin} reason={p.isAdmin ? undefined : "This needs admin access on this computer."} onPick={(id) => void p.patch({ verboseLevel: id === "as-set" ? null : id })} />
      </div>
      <div className="c-row">
        <span>Thinking text</span>
        <Segmented label="Thinking text" items={THINKING_TEXT} value={str(p.row.reasoningLevel) || "as-set"} disabled={!p.isAdmin} reason={p.isAdmin ? undefined : "This needs admin access on this computer."} onPick={(id) => void p.patch({ reasoningLevel: id === "as-set" ? null : id })} />
      </div>
        </>
      ) : null}
    </div>
  );
}

function LinkRow({ icon = "gear", label, target, onOpen, open }: { icon?: IconName; label: string; target: OpenTarget; onOpen?: (t: OpenTarget) => void; open: (t: OpenTarget) => void }) {
  return <MenuItem icon={icon} label={label} disabled={!onOpen} reason={onOpen ? undefined : NO_ROUTE} onClick={() => open(target)} />;
}
