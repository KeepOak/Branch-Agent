// Decides when a Control UI request must carry gateway auth because it arrived on a network listener.
import type { ResolvedGatewayAuth } from "./auth.js";
import { isLoopbackAddress } from "./net.js";

type ListenerSocket = { localAddress?: string | undefined } | null | undefined;

/**
 * A Control UI document or route reached through a non-loopback listener must be authorized,
 * the same as the bootstrap config. Loopback listeners keep the local window flow unchanged.
 * Fingerprinted static assets stay public: they are build output and carry no account data.
 */
export function controlUiRequestRequiresNetworkAuth(params: {
  socket: ListenerSocket;
  auth: Pick<ResolvedGatewayAuth, "mode"> | undefined;
  isStaticAsset: boolean;
}): boolean {
  if (params.isStaticAsset) {
    return false;
  }
  if (!params.auth || params.auth.mode === "none") {
    // Startup already refuses a non-loopback bind without auth.
    return false;
  }
  const localAddress = params.socket?.localAddress;
  if (!localAddress) {
    // Unknown listener address: fail closed.
    return true;
  }
  return !isLoopbackAddress(localAddress);
}
