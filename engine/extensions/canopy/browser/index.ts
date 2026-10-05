import { defineControlUiPlugin } from "branch/plugin-sdk/control-ui";
import { CanopyCatalog } from "./catalog.ts";
import { deleteCanopyBoard } from "./delete-board.ts";
import { bindCanopyHost } from "./host.ts";
import { t } from "./i18n/index.ts";
import { canopyBoardName } from "./lib/canopy/board-presentation.ts";
import { createCanopyCapability } from "./lib/canopy/capability.ts";
import { CANOPY_CHANGED_EVENT, type CanopyBoardSummary } from "./lib/canopy/types.ts";
import { createCanopyPage, canopyPageTarget } from "./pages/canopy/canopy-page.ts";
import { createCanopySessionAccessory } from "./session-accessory.ts";
import { createCanopyWidget } from "./widgets.ts";
import "./styles/canopy.css";
import "./styles/widgets.css";
import "./styles/session-chip.css";

type NavigationBoard = Pick<CanopyBoardSummary, "id" | "name" | "kind" | "icon" | "color">;

export default defineControlUiPlugin({
  id: "canopy",
  activate(host) {
    const unbind = bindCanopyHost(host);
    const canopy = createCanopyCapability();
    const client = host;
    let pendingDeletion: Promise<void> | undefined;
    const navigation = new Map<
      string,
      { board: NavigationBoard; order: number; signature: string; dispose: () => void }
    >();
    const syncBoardNavigation = (boards: readonly NavigationBoard[]) => {
      const nameCounts = new Map<string, number>();
      for (const board of boards) {
        const name = canopyBoardName(board);
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      }
      const currentIds = new Set(boards.map((board) => board.id));
      for (const [id, entry] of navigation) {
        if (!currentIds.has(id)) {
          entry.dispose();
          navigation.delete(id);
        }
      }
      for (const [index, board] of boards.entries()) {
        const name = canopyBoardName(board);
        const label = (nameCounts.get(name) ?? 0) > 1 ? `${name} (${board.kind ?? "cards"})` : name;
        const order = 20 + index;
        const signature = JSON.stringify([label, board.icon, board.color, order]);
        const entry = navigation.get(board.id);
        if (entry?.signature === signature) {
          entry.board = board;
          continue;
        }
        entry?.dispose();
        navigation.set(board.id, {
          board,
          order,
          signature,
          dispose: host.ui.registerNavigation({
            id: `board-${board.id}`,
            parent: "canopy",
            label,
            page: canopyPageTarget(board.id),
            icon: board.icon ?? "kanban",
            order,
            defaultVisible: false,
            get actions() {
              const pinned = host.ui.isNavigationPinned(`board-${board.id}`);
              return [
                {
                  id: "pin",
                  label: t(pinned ? "canopy.unpinBoard" : "canopy.pinBoard"),
                  icon: pinned ? "pinOff" : "pin",
                  run: () => {
                    const id = `board-${board.id}`;
                    if (host.ui.isNavigationPinned(id)) {
                      host.ui.unpinNavigation(id);
                    } else {
                      host.ui.pinNavigation(id);
                    }
                  },
                },
                ...(host.connection.canWrite
                  ? [
                      {
                        id: "delete",
                        label: t("canopy.deleteBoard"),
                        icon: "trash",
                        destructive: true,
                        run: () =>
                          (pendingDeletion ??= deleteCanopyBoard(host, board, () => {
                            host.ui.unpinNavigation(`board-${board.id}`);
                            catalog.removeBoard(board.id);
                          }).finally(() => {
                            pendingDeletion = undefined;
                          })),
                      },
                    ]
                  : []),
              ];
            },
          }),
        });
      }
    };
    const catalog = new CanopyCatalog(({ boards }) => syncBoardNavigation(boards), canopy);
    const registrations = [
      host.ui.registerPage({
        id: "canopy",
        label: "Canopy",
        mount: createCanopyPage(canopy, (board) => {
          const boards = [...navigation.values()]
            .toSorted((left, right) => left.order - right.order)
            .map((entry) => entry.board);
          const index = boards.findIndex((entry) => entry.id === board.id);
          boards[index < 0 ? boards.length : index] = board;
          syncBoardNavigation(boards);
        }),
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
      host.onEvent(CANOPY_CHANGED_EVENT, (payload) =>
        catalog.handleGatewayEvent(CANOPY_CHANGED_EVENT, payload),
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
