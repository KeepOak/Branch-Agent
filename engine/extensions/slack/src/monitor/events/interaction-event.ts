import { requestHeartbeat } from "branch/plugin-sdk/heartbeat-runtime";
import { enqueueRoutedSystemEvent } from "branch/plugin-sdk/system-event-runtime";

export function enqueueSlackInteractionEvent(
  ...args: Parameters<typeof enqueueRoutedSystemEvent>
): void {
  if (enqueueRoutedSystemEvent(...args)) {
    const route = args[1];
    requestHeartbeat({
      source: "hook",
      intent: "immediate",
      reason: "hook:slack-interaction",
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      heartbeat: { target: "last" },
    });
  }
}
