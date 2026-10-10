// Settings › Models (DESIGN-SPEC §4.7.6): tabs Defaults · On this computer · Second opinion · Media (accounts live in Accounts),
// then the Advanced and Technical sections every tab shares. Every choice saves at once to the engine config
// (agents.defaults.*, or agents.entries.<Trunk>.* for "Settings for"); accounts are models.authStatus.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { Btn, Hint, Page, Tabs, useLevel } from "../kit";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { useModels } from "./models-data";
import { DefaultsTab } from "./models-defaults";
import { LocalTab, MediaTab, SecondTab } from "./models-tabs";
import { ModelsSections } from "./models-more";
import { MODELS_ROWS as ROWS } from "./models-rows";

const TABS = [
  { id: "defaults", label: "Defaults" },
  { id: "local", label: "On this computer" },
  { id: "second", label: "Second opinion" },
  { id: "media", label: "Media" },
];

export function ModelsPage(props: SettingsPageProps) {
  const m = useModels(props.engine);
  const lv = useLevel();
  const trunks = useResource<RecordValue>(props.engine, "agents.list", {});
  const scopeName = m.scope ? visible(record(list(trunks.data?.agents).find((t) => t.id === m.scope)?.identity).name ?? m.scope) : "";
  const [tab, setTab] = useState("defaults");
  return (
    <Page title={props.title} lede="Which models answer, and where they run.">
      {m.scope ? <p className="scope-line-k">{scopeName}’s own settings. Rows that apply to everyone are the same for every Trunk.</p> : null}
      <Hint>Accounts, their order and pauses are in Accounts.{props.openSettings ? <> <Btn sm onClick={() => props.openSettings?.("accounts")}>Open Accounts</Btn></> : null}</Hint>
      <Tabs label="Models" tabs={TABS} value={tab} onChange={setTab} />
      {tab === "defaults" ? <DefaultsTab m={m} /> : null}
      {tab === "local" ? <LocalTab m={m} openSettings={props.openSettings} /> : null}
      {tab === "second" ? <SecondTab /> : null}
      {tab === "media" ? <MediaTab m={m} /> : null}
      {lv >= 1 ? <ModelsSections m={m} tab={tab} openSettings={props.openSettings} /> : null}
    </Page>
  );
}

export const MODELS_ROWS: RowEntry[] = ROWS;
