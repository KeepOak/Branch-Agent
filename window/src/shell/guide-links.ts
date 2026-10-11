// The Guide menu's external destinations. Both announce that they leave the app.

/** No docs site exists yet, so Docs opens the existing Help page. */
export const docsUrl = "https://keepoak.com/help";

/** KeepOak's Help & contact page. */
export const helpUrl = "https://keepoak.com/help";

export type GuideLinkItem = {
  label: string;
  run: () => void;
  hint?: string;
};

/** `open` is the window's existing external-open helper. */
export function guideLinkItems(open: (url: string) => void): GuideLinkItem[] {
  return [
    { label: "Docs (opens in browser)", run: () => { open(docsUrl); } },
    { label: "Ask for help", hint: "opens in browser", run: () => { open(helpUrl); } },
  ];
}
