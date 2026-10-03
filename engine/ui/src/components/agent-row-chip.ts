import { consume } from "@lit/context";
import { html } from "lit";
import { property } from "lit/decorators.js";
import { applicationContext, type ApplicationContext } from "../app/context.ts";
import { normalizeAgentLabel, resolveAgentTextAvatar } from "../lib/agents/display.ts";
import { resolveAgentAvatarUrl } from "../lib/avatar.ts";
import { IdentityAvatarController } from "../lib/identity-avatar-loader.ts";
import { resolveUiDefaultAgentId } from "../lib/sessions/session-key.ts";
import { BranchLightDomElement } from "../lit/branch-element.ts";
import { SubscriptionsController } from "../lit/subscriptions-controller.ts";
import { renderAgentIdentityAvatar } from "./identity-avatar-view.ts";
import "../styles/agent-row-chip.css";

export function renderAgentRowChip(agentId?: string) {
  return html`<branch-agent-row-chip .agentId=${agentId}></branch-agent-row-chip>`;
}

class AgentRowChip extends BranchLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  @property({ attribute: false })
  private context: Pick<ApplicationContext, "agents" | "agentIdentity" | "gateway"> | undefined;
  @property({ attribute: false }) agentId?: string;
  private readonly avatars = new IdentityAvatarController(this);

  constructor() {
    super();
    void new SubscriptionsController(this)
      .watchStore(() => this.context?.agents)
      .watchStore(() => this.context?.agentIdentity)
      .watchStore(() => this.context?.gateway);
  }

  override render() {
    const agentsList = this.context?.agents.state.agentsList;
    const id =
      this.agentId?.trim() ||
      resolveUiDefaultAgentId({
        agentsList,
        hello: this.context?.gateway.snapshot.hello,
      });
    const agent = agentsList?.agents.find((entry) => entry.id === id) ?? { id };
    const identity = this.context?.agentIdentity.get(id);
    const name = normalizeAgentLabel(agent, identity);
    const label = name === id ? `agent:${id}` : `${name} (agent:${id})`;
    const avatar = resolveAgentAvatarUrl(agent, identity);
    return this.avatars.withActiveRoutes(() => {
      const image = avatar ? this.avatars.resolve(avatar) : null;
      return html`<span
        class="agent-row-chip"
        data-agent-id=${id}
        role="img"
        aria-label=${label}
        title=${label}
      >
        ${renderAgentIdentityAvatar({ id, avatar: image, textAvatar: resolveAgentTextAvatar(agent, identity) }, "agent-row-chip__avatar")}
        <span class="agent-row-chip__name">${name}</span>
      </span>`;
    });
  }
}

if (!customElements.get("branch-agent-row-chip")) {
  customElements.define("branch-agent-row-chip", AgentRowChip);
}

declare global {
  interface HTMLElementTagNameMap {
    "branch-agent-row-chip": AgentRowChip;
  }
}
