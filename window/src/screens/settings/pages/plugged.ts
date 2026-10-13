// The Settings pages other screens draw, plugged into the R1 Settings frame by page id. Chat apps (R1-09) brings its own
// page and its rows; the frame keeps nav, search and the level.
import { CHAT_APP_ROWS, ChatAppsPage } from "../../chatapps";
import type { PageSlots } from "../slots";

export const R1_PAGES: PageSlots = {
  chatapps: { component: ChatAppsPage, rows: CHAT_APP_ROWS },
};
