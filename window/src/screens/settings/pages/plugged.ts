// The Settings pages other screens draw, plugged into the R1 Settings frame by page id. Chat apps (R1-09) brings its own
// page and its rows; the frame keeps nav, search and the level. Appearance keeps its row cards and draws the rows Classic
// did with more than a key (appearance-live.tsx), so the R1 page has every working Classic control (#976).
import { CHAT_APP_ROWS, ChatAppsPage } from "../../chatapps";
import type { PageSlots } from "../slots";
import { AccentColour, BackgroundPreview, EachTrunk, LightOrDark, PetPick, PetsHad, SmallModel, ThemePicker, ThreadsShowAs } from "./appearance-live";

export const R1_PAGES: PageSlots = {
  chatapps: { component: ChatAppsPage, rows: CHAT_APP_ROWS },
  appearance: {
    controls: {
      "appearance.theme.mode": LightOrDark,
      "appearance.theme.pick": ThemePicker,
      "appearance.theme.accent": AccentColour,
      "appearance.background.preview": BackgroundPreview,
      "appearance.pet.pick": PetPick,
      "appearance.pet.had": PetsHad,
      "appearance.characters.each-trunk": EachTrunk,
      "appearance.list.threads": ThreadsShowAs,
      "appearance.list.small-model": SmallModel,
    },
  },
};
