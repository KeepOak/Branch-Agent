import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("device"),
  component: () =>
    import("./device-page.ts").then(() => ({
      header: true,
      render: () => html`<branch-device-page></branch-device-page>`,
    })),
});

export const permissionsPage = definePage({
  ...routePageSpec("device-permissions"),
  component: () =>
    import("./permissions-page.ts").then(() => ({
      header: true,
      render: () => html`<branch-device-permissions-page></branch-device-permissions-page>`,
    })),
});
