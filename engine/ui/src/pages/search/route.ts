import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("search"),
  component: () =>
    import("./search-page.ts").then(() => ({
      header: true,
      render: () => html`<branch-search-page></branch-search-page>`,
    })),
});
