// Model choices inside Trunks > Models & accounts. Sign-ins and local setup have one home.
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { Page, useLevel } from "../kit";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { useModels } from "./models-data";
import { DefaultsTab } from "./models-defaults";
import { MediaTab, SecondTab } from "./models-tabs";
import { ModelsSections } from "./models-more";
import { MODELS_ROWS as ROWS } from "./models-rows";

export function ModelsPage({ tab = "defaults", ...props }: SettingsPageProps & { tab?: string }) {
  const m = useModels(props.engine);
  const lv = useLevel();
  const trunks = useResource<RecordValue>(props.engine, "agents.list", {});
  const scopeName = m.scope
    ? visible(
        record(list(trunks.data?.agents).find((t) => t.id === m.scope)?.identity).name ?? m.scope,
      )
    : "";
  return (
    <Page
      title={props.title}
      lede="Choose which models answer, using the accounts and local models here."
    >
      {m.scope ? (
        <p className="scope-line-k">
          {scopeName}’s own settings. Rows that apply to everyone are the same for every Trunk.
        </p>
      ) : null}
      {tab === "defaults" ? <DefaultsTab m={m} /> : null}
      {tab === "second" ? <SecondTab m={m} /> : null}
      {tab === "media" ? <MediaTab m={m} /> : null}
      {lv >= 1 ? <ModelsSections m={m} tab={tab} openSettings={props.openSettings} /> : null}
    </Page>
  );
}

export const MODELS_ROWS: RowEntry[] = ROWS;
