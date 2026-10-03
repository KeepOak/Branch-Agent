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
        {catalog ? <PlugSections catalog={catalog} overrides={overrides} query={query} write={write} reason={reason} isAdmin={p.isAdmin} /> : null}
      </div>
      {changed > 0 ? (
        <div className="c-plug-changed">
          <span>{changedWords(changed)}</span>
          <button
            type="button"
            className="btn sm"
            disabled={!p.isAdmin}
            title={reason}
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

function PlugSections({ catalog, overrides, query, write, reason, isAdmin }: {
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
