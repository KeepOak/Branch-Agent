import { describe, expect, it } from "vitest";
import { resolveControlUiBootstrapPresentation } from "./control-ui-bootstrap-presentation.js";

describe("Control UI model defaults bootstrap", () => {
  it.each([undefined, true, false])(
    "omits the retired community invitation flag %s",
    (communityInvite) => {
      const result = resolveControlUiBootstrapPresentation({
        gateway: { controlUi: { communityInvite } },
      });
      expect(result).not.toHaveProperty("communityInvite");
      expect(result).toEqual(resolveControlUiBootstrapPresentation(undefined));
    },
  );

  it.each([undefined, "configured"] as const)(
    "projects %s without model restrictions",
    (newSessionModelDefaults) => {
      const result = resolveControlUiBootstrapPresentation({
        gateway: { controlUi: { newSessionModelDefaults } },
      });
      expect(result.newSessionModelDefaults).toBe(newSessionModelDefaults ?? "last-used");
      expect(result).not.toHaveProperty("modelSelectionPolicy");
    },
  );
});
