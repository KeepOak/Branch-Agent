import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Tabs } from "../kit";
import { AccountsPage } from "./accounts";
import { LocalPage } from "./local";
import { ModelsPage } from "./models";

const TABS = [
  { id: "accounts", label: "Accounts" },
  { id: "defaults", label: "Default" },
  { id: "local", label: "Local" },
  { id: "second", label: "Second opinion (a second model checks answers)" },
  { id: "media", label: "Media" },
];
const modelTab = (section?: string) =>
  /second opinion/i.test(section ?? "")
    ? "second"
    : /media|pictures, video/i.test(section ?? "")
      ? "media"
      : "defaults";

/** Existing account/model/local routes and search hits open the same section at the right view. */
export function ModelsAccountsPage(props: SettingsPageProps) {
  const [selection, setSelection] = useState({
    page: props.page,
    route: props.page,
    tab: "defaults",
  });
  if (selection.page !== props.page) {
    setSelection({ ...selection, page: props.page, route: props.page });
  }
  const route = selection.page === props.page ? selection.route : props.page;
  const shown =
    route === "accounts" || route === "local"
      ? route
      : props.searchSection
        ? modelTab(props.searchSection)
        : selection.tab;
  const choose = (id: string) => {
    const route = id === "accounts" || id === "local" ? id : "models";
    setSelection({ page: props.page, route, tab: route === "models" ? id : selection.tab });
    props.openSettings?.(route);
  };
  const pageProps = { ...props, title: "Models & accounts" };
  return (
    <>
      <Tabs label="Models & accounts" tabs={TABS} value={shown} onChange={choose} />
      {shown === "accounts" ? (
        <AccountsPage {...pageProps} />
      ) : shown === "local" ? (
        <LocalPage {...pageProps} />
      ) : (
        <ModelsPage {...pageProps} tab={shown} />
      )}
    </>
  );
}
