// The plug (DESIGN-SPEC §4.3.3 and its Parity adds): the tools this conversation may use. Switches write
// sessions.patch { toolOverrides } for this conversation only (rule 2) and the row is read back from the engine.
import { useCallback, useEffect, useState, type RefObject } from "react";
import { agentOf, errorText, type Rec, type WindowEngine } from "./engine";
import { Icon } from "./icons";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { Popover } from "./Popover";
import {
  changedCount, changedWords, isOn, matchesQuery, patchValue, readConnectors, readConnectorTools, readOverrides,
  readSkills, readWebSearchBase, setWebSearch, toggle, type Connector, type SkillRow, type ToolOverrides,
} from "./tools";
import { Switch } from "./ui";
import { shownWhy } from "../shell/shown-why";

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  engine: WindowEngine;
  row: Rec;
  trunkName: string;
  isAdmin: boolean;
  patch: (fields: Record<string, unknown>) => Promise<string | null>;
  onToast?: (text: string) => void;
  onOpen?: (target: OpenTarget) => void;
};

type Catalog = { connectors: Connector[]; skills: SkillRow[]; webBase: boolean; effective: unknown };

function useCatalog(engine: WindowEngine) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const agentId = engine.agentId ?? agentOf(engine.sessionKey);
      // tools.effective needs the conversation to exist; before its first message the connectors' own tools are unknown.
      const effective = engine.request("tools.effective", { sessionKey: engine.sessionKey }).catch((e: unknown) => {
        console.warn("tools.effective:", errorText(e));
        return null;
      });
      const [config, skills] = await Promise.all([
        engine.request("config.get", {}),
        engine.request("skills.status", agentId ? { agentId } : {}),
      ]);
      setCatalog({ connectors: readConnectors(config), skills: readSkills(skills), webBase: readWebSearchBase(config), effective: await effective });
    } catch (e) {
      setError(errorText(e));
    }
  }, [engine]);
  useEffect(() => {
    void load();
  }, [load]);
  return { catalog, error, load };
}

export function PlugMenu(p: Props) {
  const { catalog, error, load } = useCatalog(p.engine);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [libChanged, setLibChanged] = useState(false);
  const overrides = readOverrides(p.row);
  const reason = p.isAdmin ? undefined : "This needs admin access on this computer.";
  const write = async (next: ToolOverrides) => {
    const problem = await p.patch({ toolOverrides: patchValue(next) });
    setFailed(problem);
    return problem;
  };
  const changed = changedCount(overrides);
  return (
    <Popover anchor={p.anchor} onClose={p.onClose} label="Tools: connectors, skills, plugins and command-line tools" className="c-plug">
      <div className="c-plug-h">
        <b>Tools for {p.trunkName}</b>
        <small>Switch one off for this conversation only.</small>
      </div>
      <label className="c-search">
        <Icon name="search" size={15} />
        <input autoFocus placeholder="Search tools" aria-label="Search tools" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="c-scroll c-plug-body">
        {error ? <p className="c-pp bad">{error} <button type="button" className="c-link" onClick={() => void load()}>Try again</button></p> : null}
        {failed ? <p className="c-pp bad">{failed}</p> : null}
        {!catalog && !error ? <p className="c-pp">Loading tools…</p> : null}
        {catalog && library ? <LibraryView skills={catalog.skills} overrides={overrides} changed={libChanged} isAdmin={p.isAdmin} reason={reason}
          onBack={() => setLibrary(false)} write={async (next) => { const problem = await write(next); if (problem === null) setLibChanged(true); return problem; }} /> : null}
        {catalog && !library ? <PlugSections catalog={catalog} overrides={overrides} query={query} write={write} reason={reason} isAdmin={p.isAdmin} onLibrary={() => setLibrary(true)} /> : null}
      </div>
      {changed > 0 ? (
        <div className="c-plug-changed">
          <span>{changedWords(changed)}</span>
          <button
            type="button"
            className="btn sm"
            disabled={!p.isAdmin}
            title={shownWhy(reason)}
            onClick={async () => {
              if ((await write({})) === null) p.onToast?.(`Tools here match ${p.trunkName}'s again.`);
            }}
          >
            Put them back
          </button>
        </div>
      ) : null}
      <AddRow onOpen={p.onOpen} onClose={p.onClose} />
    </Popover>
  );
}

function PlugSections({ catalog, overrides, query, write, reason, isAdmin, onLibrary }: {
  onLibrary: () => void;
  catalog: Catalog;
  overrides: ToolOverrides;
  query: string;
  write: (next: ToolOverrides) => Promise<string | null>;
  reason?: string;
  isAdmin: boolean;
}) {
  const connectors = catalog.connectors.filter((c) => matchesQuery(c.name, c.line, query));
  const skills = catalog.skills.filter((s) => matchesQuery(s.name, s.line, query));
  const webShown = matchesQuery("Web search", "Search the web in this conversation.", query);
  const webOn = catalog.webBase ? isOn(true, overrides.webSearch) : false;
  const staleOn = !catalog.webBase && overrides.webSearch === true;
  const nothing = connectors.length === 0 && skills.length === 0 && !webShown;
  return (
    <>
      {webShown ? (
        <ToolRow icon="globe" name="Web search" line={catalog.webBase ? "Search the web in this conversation." : "Web search is off for every conversation."}>
          <Switch
            on={webOn}
            label="Web search"
            disabled={!isAdmin || (!catalog.webBase && !staleOn)}
            reason={reason ?? (catalog.webBase ? undefined : "Web search is off for every conversation.")}
            onChange={(on) => void write(staleOn ? setWebSearch(overrides, false, false) : setWebSearch(overrides, on, true))}
          />
        </ToolRow>
      ) : null}
      {connectors.length > 0 ? (
        <Section title="Connectors" on={connectors.filter((c) => isOn(c.enabled, overrides.mcpServers?.[c.name])).length}>
          {connectors.map((c) => (
            <ConnectorRow key={c.name} connector={c} catalog={catalog} overrides={overrides} write={write} reason={reason} isAdmin={isAdmin} />
          ))}
        </Section>
      ) : null}
      {skills.length > 0 ? (
        <Section title="Skills" on={skills.filter((s) => !s.problem && isOn(s.baseEnabled, overrides.skills?.[s.key])).length}>
          {!query ? (
            <button type="button" className="c-tool c-libadd" onClick={onLibrary}>
              <span className="c-tile"><Icon name="doc" size={15} /></span>
              <span className="c-tool-t"><b>Add from your library…</b></span>
              <Icon name="chevRight" size={15} />
            </button>
          ) : null}
          {skills.map((s) => (
            <ToolRow key={s.key} icon="puzzle" name={s.name} line={s.line} here={overrides.skills?.[s.key] !== undefined}>
              {s.problem ? (
                <span className={`c-pill ${s.problem === "Needs a key" ? "warn" : "no"}`}>{s.problem}</span>
              ) : (
                <Switch
                  on={isOn(s.baseEnabled, overrides.skills?.[s.key])}
                  label={s.name}
                  disabled={!isAdmin}
                  reason={reason}
                  onChange={(on) => void write(toggle(overrides, "skills", s.key, on, s.baseEnabled))}
                />
              )}
            </ToolRow>
          ))}
        </Section>
      ) : null}
      {nothing ? <p className="c-pp">No tool by that name.</p> : null}
    </>
  );
}

function Section({ title, on, children }: { title: string; on: number; children: React.ReactNode }) {
  return (
    <section className="c-plug-sec" aria-label={title}>
      <div className="c-ph"><span>{title}</span><span>{on} on</span></div>
      {children}
    </section>
  );
}

function ToolRow({ icon, name, line, here, children }: { icon: "globe" | "puzzle" | "plug"; name: string; line: string; here?: boolean; children: React.ReactNode }) {
  return (
    <div className="c-tool" data-testid="tool-row">
      <span className="c-tile"><Icon name={icon} size={15} /></span>
      <span className="c-tool-t">
        <b>{name}{here ? <span className="c-pill">Here only</span> : null}</b>
        <small>{line}</small>
      </span>
      {children}
    </div>
  );
}

function ConnectorRow({ connector, catalog, overrides, write, reason, isAdmin }: {
  connector: Connector;
  catalog: Catalog;
  overrides: ToolOverrides;
  write: (next: ToolOverrides) => Promise<string | null>;
  reason?: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tools = readConnectorTools(catalog.effective, connector.name);
  const denied = overrides.mcpToolsDeny?.[connector.name] ?? [];
  const line = tools ? `${tools.length - denied.length} of ${tools.length} tools on` : connector.line;
  const setDenied = (name: string, on: boolean) => {
    const list = on ? denied.filter((n) => n !== name) : [...denied, name];
    const deny = { ...(overrides.mcpToolsDeny ?? {}), [connector.name]: list };
    if (list.length === 0) delete deny[connector.name];
    void write({ ...overrides, mcpToolsDeny: deny });
  };
  return (
    <>
      <ToolRow icon="plug" name={connector.name} line={line} here={overrides.mcpServers?.[connector.name] !== undefined || denied.length > 0}>
        <button type="button" className="c-chev" aria-expanded={open} aria-label="Tool access" onClick={() => setOpen(!open)}>
          <Icon name={open ? "chev" : "chevRight"} size={15} />
        </button>
        <Switch
          on={isOn(connector.enabled, overrides.mcpServers?.[connector.name])}
          label={connector.name}
          disabled={!isAdmin}
          reason={reason}
          onChange={(on) => void write(toggle(overrides, "mcpServers", connector.name, on, connector.enabled))}
        />
      </ToolRow>
      {open ? (
        <div className="c-subtools">
          {tools ? (
            tools.map((t) => (
              <div key={t.name} className="c-tool sm">
                <span className="c-tool-t"><b>{t.name}</b><small>{t.line}</small></span>
                <Switch on={!denied.includes(t.name)} label={t.name} disabled={!isAdmin} reason={reason} onChange={(on) => setDenied(t.name, on)} />
              </div>
            ))
          ) : (
            <p className="c-pp">Its tools show once the next task starts.</p>
          )}
        </div>
      ) : null}
    </>
  );
}

function AddRow({ onOpen, onClose }: { onOpen?: (t: OpenTarget) => void; onClose: () => void }) {
  const go = () => {
    onClose();
    onOpen?.("customize/tools");
  };
  const kinds: Array<[string, "plug" | "puzzle" | "term" | "sliders"]> = [
    ["Connector", "plug"],
    ["Skill", "puzzle"],
    ["CLI", "term"],
    ["Plugin", "sliders"],
  ];
  return (
    <div className="c-plug-foot">
      <div className="c-add">
        {kinds.map(([label, icon]) => (
          <button key={label} type="button" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={go}>
            <Icon name={icon} size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="c-manage" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={go}>
        <span>Manage tools</span>
        <Icon name="chevRight" size={15} />
      </button>
    </div>
  );
}

/** The library split: skills on in this conversation, and the ones that could be added (skills with a problem are left out). */
export function libraryLists(skills: SkillRow[], overrides: ToolOverrides): { chosen: SkillRow[]; rest: SkillRow[] } {
  const usable = skills.filter((s) => !s.problem);
  const on = (s: SkillRow) => isOn(s.baseEnabled, overrides.skills?.[s.key]);
  return { chosen: usable.filter(on), rest: usable.filter((s) => !on(s)) };
}

/** Skills for this conversation (the preview's libPK18): the skills chosen here and the rest of your library, each
 *  added or removed for this conversation only (toolOverrides.skills, as the switches above write). */
function LibraryView({ skills, overrides, changed, isAdmin, reason, onBack, write }: {
  skills: SkillRow[]; overrides: ToolOverrides; changed: boolean; isAdmin: boolean; reason?: string; onBack: () => void;
  write: (next: ToolOverrides) => Promise<string | null>;
}) {
  const set = (s: SkillRow, value: boolean) => void write(toggle(overrides, "skills", s.key, value, s.baseEnabled));
  const { chosen, rest } = libraryLists(skills, overrides);
  const row = (s: SkillRow, button: React.ReactNode) => (
    <div key={s.key} className="c-librow">
      <span className="c-tool-t"><b>{s.name}</b><small>{s.line}</small></span>
      {button}
    </div>
  );
  return (
    <div className="c-lib">
      <button type="button" className="c-tool c-libback" onClick={onBack}>
        <Icon name="back" size={15} />
        <span className="c-tool-t"><b>Skills for this conversation</b></span>
      </button>
      <div className="c-ph"><span>Chosen here</span></div>
      {chosen.length ? chosen.map((s) => row(s, <button type="button" className="btn ghost sm" disabled={!isAdmin} title={shownWhy(reason)} onClick={() => set(s, false)}>Remove</button>)) : <p className="c-pp">No library skills chosen here.</p>}
      <div className="c-ph"><span>Add from your libraries</span></div>
      {rest.length ? rest.map((s) => row(s, <button type="button" className="btn sm" disabled={!isAdmin} title={shownWhy(reason)} onClick={() => set(s, true)}>Add</button>)) : <p className="c-pp">Every library skill is chosen here.</p>}
      <p className="c-pp c-libhint">{changed ? "Skill changes apply from the next step. A step already running keeps its version." : "New conversations start with your default skills. This one keeps the ones chosen here."}</p>
    </div>
  );
}
