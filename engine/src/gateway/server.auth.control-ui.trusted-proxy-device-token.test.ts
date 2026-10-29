/**
 * Gateway Control UI auth pairing tests: trusted-proxy and device-token suites.
 */
import { describe } from "vitest";
import { registerControlUiDeviceTokenSuite } from "./server.auth.control-ui.device-token.suite.js";
import { registerControlUiTrustedProxySuite } from "./server.auth.control-ui.trusted-proxy.suite.js";
import { installGatewayTestHooks } from "./server.auth.test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

await Promise.all([
  import("./server.js"),
  import("../infra/device-bootstrap.js"),
  import("../infra/device-identity.js"),
  import("../infra/device-pairing.js"),
]);

describe("gateway server auth/connect", () => {
  registerControlUiTrustedProxySuite();
  registerControlUiDeviceTokenSuite();
});
