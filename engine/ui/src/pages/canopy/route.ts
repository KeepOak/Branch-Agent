import type { RouteLocation } from "@openclaw/uirouter";
import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";
import {
  resolveCanopyRouteLocation,
  canopyRouteLocation,
  type CanopyRouteData,
} from "./route-location.ts";

export const page = definePage({
  ...routePageSpec("canopy"),
  loaderDeps: (context: ApplicationContext, location: RouteLocation) => {
    const routeLocation = canopyRouteLocation(location);
    const route = resolveCanopyRouteLocation(routeLocation, context.basePath);
    const canonicalLocation = route.canonicalLocation;
    return `${canonicalLocation?.pathname ?? routeLocation.pathname}\u0000${
      canonicalLocation?.search ?? route.search
    }`;
  },
  loader: (context: ApplicationContext, { location }) =>
    resolveCanopyRouteLocation(location, context.basePath),
  component: () =>
    import("../plugin/plugin-page.ts").then(() => ({
      header: true,
      render: (data: CanopyRouteData | undefined) =>
        html`<branch-plugin-page
          .pluginId=${"canopy"}
          .tabId=${"canopy"}
          .params=${{ boardId: data?.boardFilter ?? "__all__" }}
        ></branch-plugin-page>`,
    })),
});
