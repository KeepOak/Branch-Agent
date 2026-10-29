/**
 * Gateway Control UI auth pairing tests: pairing and mobile bootstrap suites.
 */
import { describe } from "vitest";
import { registerControlUiMobileBootstrapSuite } from "./server.auth.control-ui.mobile-bootstrap.suite.js";
import { registerControlUiMobileReconnectSuite } from "./server.auth.control-ui.mobile-reconnect.suite.js";
import { registerControlUiPairingSuite } from "./server.auth.control-ui.pairing.suite.js";
import { installGatewayTestHooks } from "./server.auth.test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

await Promise.all([
  import("./server.js"),
  import("../infra/device-bootstrap.js"),
  import("../infra/device-identity.js"),
  import("../infra/device-pairing.js"),
]);

describe("gateway server auth/connect", () => {
  registerControlUiPairingSuite();
  describe("mobile bootstrap", registerControlUiMobileBootstrapSuite);
  registerControlUiMobileReconnectSuite();
});
