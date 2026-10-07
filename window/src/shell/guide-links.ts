// Guide menu external links: Docs, Get help and Community.

/** No docs site exists yet, so Docs opens the KeepOak homepage. */
export const docsUrl = "https://keepoak.com";

/** Get help opens the KeepOak homepage. */
export const helpUrl = "https://keepoak.com";

/** Community has no real address yet. */
export const communityUrl: string | null = null;

export const communityDisabledReason = "There's no community site yet.";

export type GuideLinkItem = {
  label: string;
  run: () => void;
  disabled?: string;
};

/** Docs, Get help and Community. `open` is the window's existing external-open helper. */
export function guideLinkItems(open: (url: string) => void): GuideLinkItem[] {
  return [
    { label: "Docs", run: () => { open(docsUrl); } },
    { label: "Get help", run: () => { open(helpUrl); } },
    {
      label: "Community",
      run: () => { if (communityUrl) open(communityUrl); },
      disabled: communityUrl ? undefined : communityDisabledReason,
    },
  ];
}
