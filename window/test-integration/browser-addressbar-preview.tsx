// Preview-only fixture: renders the real BrowserView against an in-memory browser API. No gateway, no live data.
import { createRoot } from "react-dom/client";
import { BrowserView } from "../src/stage/BrowserView";
import "../src/theme/tokens.css";
import "../src/theme/base.css";
import "../src/shell/frame.css";
import "../src/stage/stage.css";

const mode = new URLSearchParams(location.search).get("state") ?? "started";
const tabs: { targetId: string; title: string; url: string; type: string }[] = [];
const tab = { target: "node" as const, node: "node-one", profile: "work", targetId: "tab-one" };
const blocks = [{ kind: "step" as const, key: "open", tool: "browser", title: "Open", detail: "", status: "ok" as const, browser: { tab, revision: "open" } }];
if (mode === "page") tabs.push({ targetId: "tab-one", title: "Example Domain", url: "https://example.com/", type: "page" });

const engine = {
  sessionKey: "agent:scout:one",
  scopes: ["operator.admin"],
  onEvent: () => () => {},
  request: async (_method: string, params: { path?: string; body?: { url?: string } }) => {
    const path = params.path ?? "";
    if (path === "/") return { running: true };
    if (path === "/tabs") return { tabs };
    if (path === "/tabs/open") {
      tabs.push({ targetId: "tab-new", title: "Typed page", url: params.body?.url ?? "about:blank", type: "page" });
      return { targetId: "tab-new" };
    }
    return {};
  },
};

createRoot(document.getElementById("root")!).render(
  <section className="stage7 computer-stage" style={{ width: 900, height: 560 }}>
    <BrowserView engine={engine as never} gatewayUrl="ws://preview.invalid" blocks={blocks as never} name="Scout" control={false} onState={() => undefined} />
  </section>,
);
