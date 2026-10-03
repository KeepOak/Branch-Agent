import { defineControlUiPlugin } from "branch/plugin-sdk/control-ui";
import { createCanopyCatalogRuntime } from "./catalog.ts";
import { bindCanopyHost } from "./host.ts";
import { canopyBoardLabel } from "./lib/canopy/board-presentation.ts";
import { createCanopyCapability } from "./lib/canopy/capability.ts";
import { CANOPY_CHANGED_EVENT } from "./lib/canopy/types.ts";
import { createCanopyPage, canopyPageTarget } from "./pages/canopy/canopy-page.ts";
import { createCanopySessionAccessory } from "./session-accessory.ts";
import { createCanopyWidget } from "./widgets.ts";
import "./styles/canopy.css";
import "./styles/widgets.css";
import "./styles/session-chip.css";

export default defineControlUiPlugin({
  id: "canopy",
  activate(host) {
    const unbind = bindCanopyHost(host);
    const canopy = createCanopyCapability();
    const client = host;
    const navigation = new Map<string, { signature: string; dispose: () => void }>();
    const catalog = createCanopyCatalogRuntime(({ boards }) => {
      const currentIds = new Set(boards.map((board) => board.id));
      for (const [id, entry] of navigation) {
        if (!currentIds.has(id)) {
          entry.dispose();
          navigation.delete(id);
        }
      }
      for (const board of boards) {
        const label = canopyBoardLabel(board);
        const signature = JSON.stringify([label, board.icon, board.color]);
        if (navigation.get(board.id)?.signature === signature) {
          continue;
        }
        navigation.get(board.id)?.dispose();
        navigation.set(board.id, {
          signature,
          dispose: host.ui.registerNavigation({
            id: `board-${board.id}`,
            label,
            page: canopyPageTarget(board.id),
            icon: board.icon,
            order: 20,
            defaultVisible: false,
          }),
        });
      }
    }, canopy);
    const registrations = [
      host.ui.registerPage({
        id: "canopy",
        label: "Canopy",
        mount: createCanopyPage(canopy),
      }),
      host.ui.registerNavigation({
        id: "canopy",
        label: "Canopy",
        page: canopyPageTarget(),
        icon: "kanban",
        order: 10,
      }),
      host.ui.registerAccessory({
        id: "linked-card",
        placement: "session-header",
        mount: createCanopySessionAccessory(canopy),
      }),
      ...(["mini", "card", "board"] as const).map((id) =>
        host.ui.registerWidget({
          id,
          label:
            id === "mini"
              ? "Canopy summary"
              : id === "card"
                ? "Canopy card"
                : "Canopy board",
          mount: createCanopyWidget(host, id),
        }),
      ),
      canopy.subscribe(host.ui.invalidate),
      host.subscribe(() => catalog.sync(client, host.connection.connected)),
      host.onEvent(CANOPY_CHANGED_EVENT, () =>
        catalog.handleGatewayEvent(CANOPY_CHANGED_EVENT),
      ),
    ];
    catalog.sync(client, host.connection.connected);
    return () => {
      for (const dispose of registrations.toReversed()) {
        dispose();
      }
      for (const { dispose } of navigation.values()) {
        dispose();
      }
      catalog.dispose();
      canopy.dispose();
      unbind();
    };
  },
});
