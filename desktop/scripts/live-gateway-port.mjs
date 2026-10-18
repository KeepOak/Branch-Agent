// The port the desktop's engine serves on right now. An in-place update hands the engine to a spare port, and the
// desktop records the live one in <data>/gateway-port (desktop/src/main.ts adoptGatewayPort), so tools read that file
// and keep the configured port only for an app that has never written it (Private #1054).
//   node desktop/scripts/live-gateway-port.mjs <dataDir>   prints the port
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** desktop/src/config.ts DEFAULTS.gatewayPort: only for a data folder with no gateway-port yet. */
export const CONFIGURED_GATEWAY_PORT = 19031;

export function liveGatewayPort(dataDir, fallback = CONFIGURED_GATEWAY_PORT) {
  let value = "";
  try { value = readFileSync(join(dataDir, "gateway-port"), "utf8").split(/\r?\n/u)[0].trim(); } catch { return fallback; }
  const port = /^\d{1,5}$/u.test(value) ? Number(value) : 0;
  return port > 0 && port < 65536 ? port : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) { console.error("usage: node live-gateway-port.mjs <dataDir>"); process.exit(2); }
  console.log(liveGatewayPort(process.argv[2]));
}
