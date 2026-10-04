// The + new menu (DESIGN-SPEC §4.1.4). Each row runs its action and closes the menu.
import type { PlaceId } from "../places-nav/routes";
import type { MenuItem } from "./Menu";
import { openNewGroupChat } from "../rooms/NewGroupChat";
import { menuIcon } from "./menu-icons";

type Ctx = { newConversation: () => void; openPlace: (p: PlaceId) => void; makeTrunk: () => void; quickAsk: () => void };

export function newMenuItems(c: Ctx): MenuItem[] {
  return [
    { label: "New conversation", icon: menuIcon("chat"), keys: "Ctrl N", run: c.newConversation, testid: "new-conversation" },
    { label: "New Trunk", icon: menuIcon("plus"), run: () => c.openPlace("customize"), testid: "new-trunk" },
    { label: "New group chat", icon: menuIcon("users"), hint: "people, Trunks, agents", run: openNewGroupChat, testid: "new-group-chat" },
    { label: "New automation", icon: menuIcon("clock"), run: () => c.openPlace("automations"), testid: "new-automation" },
    { label: "A Trunk from a job…", icon: menuIcon("star"), run: () => c.openPlace("customize") },
    { label: "Have Branch make a Trunk", icon: menuIcon("spark"), run: c.makeTrunk, testid: "new-make-trunk" },
    { label: "Quick ask", icon: menuIcon("quick"), keys: "Ctrl Shift Space", run: c.quickAsk, testid: "new-quick-ask" },
  ];
}
