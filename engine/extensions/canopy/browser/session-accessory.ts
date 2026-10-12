import { html, nothing, render } from "lit";
import type { ControlUiAccessory } from "branch/plugin-sdk/control-ui";
import { icons } from "./components/icons.ts";
import { t } from "./i18n/index.ts";
import { canopyCardBoardId } from "./lib/canopy/board-filter.ts";
import type { CanopyCapability } from "./lib/canopy/capability.ts";
import { isActiveCanopyCard } from "./lib/canopy/card-state.ts";
import { findCanopySessionCard } from "./lib/canopy/session-links.ts";
import { matchesAgentScope } from "./pages/canopy/agent-filter.ts";
import { canopyPageTarget } from "./pages/canopy/canopy-page.ts";

export function createCanopySessionAccessory(
  canopy: CanopyCapability,
): ControlUiAccessory["mount"] {
  return (container, initialContext) => {
    let context = initialContext;
    let disposed = false;
    const host = context.host;
    const draw = () => {
      const card =
        context.presented && host.connection.connected
          ? findCanopySessionCard(canopy.state.cards, context.props.sessionKey)
          : null;
      const target = card ? canopyPageTarget(canopyCardBoardId(card)) : null;
      render(
        card && isActiveCanopyCard(card) && target
          ? html`<a
              class="canopy-session-chip"
              href=${host.navigation.pageHref(target)}
              aria-label=${`${card.title} — ${t(`canopy.status.${card.status}`)}`}
              @click=${(event: MouseEvent) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                if (
                  disposed ||
                  !context.presented ||
                  context.signal.aborted ||
                  !host.connection.connected
                ) {
                  return;
                }
                if (
                  !matchesAgentScope(
                    card,
                    host.agents.defaultId ?? host.connection.assistantAgentId,
                    host.agents.scopeId,
                  )
                ) {
                  host.agents.setScope(null);
                }
                host.navigation.openPage(target);
              }}
              >${icons.kanban}<span class="canopy-session-chip__title">${card.title}</span
              ><span class="canopy-session-chip__status"
                >${t(`canopy.status.${card.status}`)}</span
              ></a
            >`
          : nothing,
        container,
      );
    };
    const stopHost = host.subscribe(draw);
    const stopState = canopy.subscribe(draw);
    draw();
    return {
      update(next) {
        context = next;
        draw();
      },
      dispose() {
        disposed = true;
        stopHost();
        stopState();
        render(nothing, container);
      },
    };
  };
}
