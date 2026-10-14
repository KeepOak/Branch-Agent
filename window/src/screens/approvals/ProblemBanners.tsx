// Problem and news banners in the R1 window, drawn with the R1 Banners shell (QUEUE item 12). The Classic hooks raise
// them unchanged: the computer can't be reached, a chat app just disconnected (shell/problem-banners.ts), and a
// conversation that isn't on screen finished (shell/banner-news.ts). Approvals are left to ApprovalsLayer, which shows
// them with Yes / No / Open, and it draws these rows in the same stack.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { clearBanner, currentBanner, raiseBanner, subscribeBanner, type ShownBanner } from "../../shell/Banner";
import { bannerFor } from "../../shell/banner-news";
import { Icon } from "../../shell/icons";
import { useDiskFullBanner, useProblemBanners } from "../../shell/problem-banners";
import type { BannerItem } from "./Banners";

type Props = {
  session: SaplingSession;
  /** The conversation on screen; news about it shows in the conversation, not as a banner. */
  shownKey: string | null;
  machineName: string;
  defaultName: string;
  titleOf: (sessionKey: string) => string;
  trunkOf: (sessionKey: string) => string;
  onOpen: (sessionKey: string) => void;
  /** Where "Open connection" goes in this window. */
  onOpenConnection: () => void;
  /** "Ask <Trunk>": opens the default Trunk's conversation and sends the question. */
  onAsk: (text: string) => void;
};

/** The Classic banner as an R1 banner row: its face or line icon, title (×N), text and its one action. */
export function bannerItem(banner: ShownBanner, onOpen: (sessionKey: string) => void): BannerItem {
  // A repeat keeps the stored id but has a new time, so the row is drawn afresh and its 6 s timer starts again.
  const id = `${PREFIX}${banner.id}:${banner.at}`;
  const action = banner.action;
  const key = banner.sessionKey;
  return {
    id,
    title: banner.count > 1 ? `${banner.title} ×${banner.count}` : banner.title,
    body: banner.text,
    sticky: banner.sticky,
    face: banner.trunkName ? <Face size={28} label={banner.trunkName} /> : <span className="r1-banner-icon" data-icon={banner.icon ?? "bell"}><Icon name={banner.icon ?? "bell"} size={16} /></span>,
    // A chat app banner's "Ask <Trunk>" sends a message, so it waits for chat.send; "Open connection" only moves
    // around this window.
    actions: action ? banner.icon === "chat" ? (
      <Coming need="chat.send" reason="This engine can’t take a message from a banner."><button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" data-testid="banner-action" onClick={() => { clearBanner(banner.id); action.run(); }}>{action.label}</button></Coming>
    ) : (
      <button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" data-local="" data-testid="banner-action" onClick={() => { clearBanner(banner.id); action.run(); }}>{action.label}</button>
    ) : key ? (
      <button type="button" className="r1-ask-btn" data-kind="ghost" data-local="" data-testid="banner-open" onClick={() => { clearBanner(banner.id); onOpen(key); }}>Open</button>
    ) : undefined,
  };
}

/** The banner rows ApprovalsLayer draws above its own (one stack, top right), with how to dismiss one. */
export type MoreBanners = { items: BannerItem[]; dismiss: (id: string) => void };
const PREFIX = "problem:";

export function useProblemBannerRows({ session, shownKey, machineName, defaultName, titleOf, trunkOf, onOpen, onOpenConnection, onAsk }: Props): MoreBanners {
  const phase = useSyncExternalStore(session.subscribe, () => session.getSnapshot().status.phase);
  const latest = useRef({ shownKey, titleOf, trunkOf });
  latest.current = { shownKey, titleOf, trunkOf };
  useEffect(() => session.onGatewayEvent((event, payload) => {
    if (event === "exec.approval.requested") return;
    const { shownKey: open, titleOf: title, trunkOf: trunk } = latest.current;
    const news = bannerFor(event, payload, open, { title, trunk });
    if (news) raiseBanner(news);
  }), [session]);
  useProblemBanners({ session, phase, machineName, defaultName, openConnection: onOpenConnection, askDefault: onAsk });
  useDiskFullBanner();
  const banner = useSyncExternalStore(subscribeBanner, currentBanner);
  const items = useMemo(() => (banner ? [bannerItem(banner, onOpen)] : []), [banner, onOpen]);
  return useMemo(() => ({ items, dismiss: (id: string) => { if (id.startsWith(PREFIX)) clearBanner(Number(id.slice(PREFIX.length).split(":")[0])); } }), [items]);
}
