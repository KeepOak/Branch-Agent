// The Guide menu's external destinations. Every row that leaves the app carries the same hint.

/** Reserved for a real docs site. Docs is left out of the menu until it exists, because today it would open the same Help page as Ask for help. */
export const docsUrl = "https://keepoak.com/help";

/** KeepOak's Help & contact page. */
export const helpUrl = "https://keepoak.com/help";

/** Shown on every row that opens the browser; labels stay plain. */
export const externalHint = "opens in browser";

export type GuideLinkItem = {
  label: string;
  run: () => void;
  hint?: string;
};

/** `open` is the window's existing external-open helper. */
export function guideLinkItems(open: (url: string) => void): GuideLinkItem[] {
  return [
    { label: "Ask for help", hint: externalHint, run: () => { open(helpUrl); } },
  ];
}
