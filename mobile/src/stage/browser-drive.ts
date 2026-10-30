// What you do on the browser pane, as browser.request POST /act bodies. Copied from the drive() switch
// in window/src/stage/BrowserView.tsx. The route has no pointer move or coordinate drag, so those stay here.
import { scrollAtPoint } from "./browser-input";
import type { RemoteAction } from "./remote-action";

export function browserAct(action: RemoteAction): Record<string, unknown> | null {
  switch (action.kind) {
    case "click":
      return { kind: "clickCoords", x: action.x, y: action.y, ...(action.button === "right" ? { button: "right" } : {}) };
    case "type":
      return { kind: "insertText", text: action.text };
    case "key":
      return { kind: "press", key: action.key };
    case "scroll":
      return { kind: "evaluate", fn: scrollAtPoint(action.x, action.y, action.dx, action.dy) };
    default:
      return null;
  }
}
