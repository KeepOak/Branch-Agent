import { asDateTimestampMs } from "@branch/normalization-core/number-coercion";
import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { formatDateTimeMs, formatRelativeTimestamp } from "../lib/format.ts";
import { BranchLightDomElement } from "../lit/branch-element.ts";
import { PollController } from "../lit/poll-controller.ts";

class RelativeTime extends BranchLightDomElement {
  @property({ attribute: false }) timestampMs: number | null = null;

  private readonly polling = new PollController(
    this,
    60_000,
    () => this.requestUpdate(),
    false,
    "visible",
  );

  override connectedCallback() {
    super.connectedCallback();
    this.polling.start();
    this.requestUpdate();
  }

  override render() {
    const timestamp = asDateTimestampMs(this.timestampMs);
    return timestamp === undefined
      ? nothing
      : html`<time
          datetime=${new Date(timestamp).toISOString()}
          title=${formatDateTimeMs(timestamp)}
          >${formatRelativeTimestamp(timestamp)}</time
        >`;
  }
}

if (!customElements.get("branch-relative-time")) {
  customElements.define("branch-relative-time", RelativeTime);
}
