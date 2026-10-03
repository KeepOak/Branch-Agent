import { dispatchChannelInboundTurn } from "branch/plugin-sdk/channel-inbound";
import { resolveDirectStatusReplyForSession } from "branch/plugin-sdk/command-status-runtime";
import { ensureConfiguredBindingRouteReady } from "branch/plugin-sdk/conversation-binding-runtime";
import { getSessionEntry } from "branch/plugin-sdk/session-store-runtime";
import { resolveDiscordNativeInteractionRouteState } from "./native-command-route.js";

export const nativeCommandRuntime = {
  dispatchChannelInboundTurn,
  ensureConfiguredBindingRouteReady,
  resolveDirectStatusReplyForSession,
  resolveDiscordNativeInteractionRouteState,
  getSessionEntry,
};
