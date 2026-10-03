// Places the composer's links open. The shell owns routing; it passes `onOpen` to the composer.
export type OpenTarget =
  | "settings/models"
  | "settings/accounts"
  | "settings/permissions"
  | "settings/voice"
  | "customize/tools"
  | "local-model-setup";

/** The reason a link is greyed while the window has nowhere to open it. */
export const NO_ROUTE = "This window can't open that page yet: the shell has no route for it.";
