// Test-only component render. No gateway, session, model or live user data is fabricated.
import { createRoot } from "react-dom/client";
import { CharacterPanel } from "../src/face/CharacterPanel";
import { TrunkAppearances, trunkAppearance } from "../src/face/appearance";
import "../src/theme/tokens.css";
import "../src/theme/base.css";
import "../src/shell/frame.css";
import "../src/shell/preview.css";
const chosen = trunkAppearance("ember", "Selected character");
const appearances = chosen ? { "Selected character": chosen } : {};
createRoot(document.getElementById("root")!).render(
  <TrunkAppearances.Provider value={appearances}>
    <p style={{ padding: 16 }}>Component test fixture: waiting state, actual production faces and styles.</p>
    <div className="parity-test-panels">
      <section><CharacterPanel name="Unconfigured Trunk" state="wait" onClose={() => {}} /></section>
      <section><CharacterPanel name="Selected character" state="wait" onClose={() => {}} /></section>
    </div>
    <style>{`.parity-test-panels {display:flex;gap:24px;padding:24px}.parity-test-panels section {position:relative;width:220px;height:260px}.parity-test-panels .character-panel {position:relative;right:auto;bottom:auto;width:fit-content}`}</style>
  </TrunkAppearances.Provider>,
);
