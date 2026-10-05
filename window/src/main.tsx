import { createRoot } from "react-dom/client";
import "./theme/tokens.css";
import "./theme/base.css";
import { applySavedTheme } from "./theme/theme";
import { applySavedLook } from "./places/settings/set1/appearance-store";
import { App } from "./App";
import { startDesktopTitleBar } from "./connect/title-bar";

applySavedTheme();
applySavedLook(); // the person's theme, accent, fonts and text size before the first draw
startDesktopTitleBar(); // inside the Branch app on Windows: the header is the title bar
createRoot(document.getElementById("root")!).render(<App />);
