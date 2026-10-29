/**
 * Gateway Control UI auth pairing tests: bootstrap lifecycle and owner bootstrap suites.
 */
import { describe } from "vitest";
import { registerControlUiBootstrapLifecycleSuite } from "./server.auth.control-ui.bootstrap-lifecycle.suite.js";
import { registerControlUiOwnerBootstrapSuite } from "./server.auth.control-ui.owner-bootstrap.suite.js";
import { installGatewayTestHooks } from "./server.auth.test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

await Promise.all([
  import("./server.js"),
  import("../infra/device-bootstrap.js"),
  import("../infra/device-identity.js"),
  import("../infra/device-pairing.js"),
]);

describe("gateway server auth/connect", () => {
  registerControlUiBootstrapLifecycleSuite();
  registerControlUiOwnerBootstrapSuite();
});
