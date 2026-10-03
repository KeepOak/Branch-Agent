import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("trellisIndex"),
  component: () =>
    import("./trellisIndex-page.ts").then(() => ({
      header: true,
      render: () => html`<branch-trellisIndex-page></branch-trellisIndex-page>`,
    })),
});
