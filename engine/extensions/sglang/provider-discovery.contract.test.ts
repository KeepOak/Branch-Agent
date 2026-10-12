import { describeSglangProviderDiscoveryContract } from "branch/plugin-sdk/provider-test-contracts";

describeSglangProviderDiscoveryContract({
  load: () => import("./index.js"),
});
