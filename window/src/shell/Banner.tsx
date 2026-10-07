import { useEffect, useSyncExternalStore } from "react";
import { Pebble } from "../face/Pebble";
import { Icon } from "./icons";
import { dismiss, getToasts } from "./notify";

// The notification banner (DESIGN-SPEC §4.10.1): one at a time, top right, 9 s, × and "Open". It says that a
// Trunk finished something or needs the person, about a conversation that is not the one on screen.
export type BannerNews = {
  /** The Trunk the news is about, for its face; absent for a banner not tied to a Trunk (a line icon then). */
  trunkName?: string;
  title: string;
  text: string;
  /** The conversation "Open" goes to. */
  sessionKey?: string;
  /** A same banner again while it shows adds "×N" instead of a new one. */
  sameAs?: string;
  /** A problem banner (§4.10.1 line-icon variant): an alert or chat icon, and its own action in Open's place. */
  icon?: "alert" | "chat";
  action?: { label: string; run: () => void };
};
export type Banner = BannerNews & { id: number; at: number; count: number };

export const BANNER_MS = 9000;
let current: Banner | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function raiseBanner(news: BannerNews): void {
  for (const toast of getToasts()) dismiss(toast.id);
  if (current && news.sameAs && current.sameAs === news.sameAs) {
    current = { ...current, count: current.count + 1, at: Date.now() };
  } else {
    current = { ...news, id: nextId++, at: Date.now(), count: 1 };
  }
  emit();
}

export function clearBanner(id?: number): void {
  if (current && (id === undefined || current.id === id)) {
    current = null;
    emit();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;

export function BannerView({ onOpen, setupOpen = false }: { onOpen: (sessionKey: string) => void; setupOpen?: boolean }) {
  const banner = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => clearBanner(banner.id), Math.max(0, banner.at + BANNER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [banner]);
  if (!banner || setupOpen) {
    return null;
  }
  return (
    <div className="banner" role="status" data-testid="banner">
      {banner.trunkName ? (
        <Pebble size={30} label={banner.trunkName} />
      ) : (
        <span className={banner.icon ? "sr-tile banner-tile problem" : "sr-tile banner-tile"}>
          <Icon name={banner.icon ?? "bell"} small />
        </span>
      )}
      <div className="banner-body">
        <span className="banner-src">Branch · now</span>
        <b className="banner-title">
          {banner.title}
          {banner.count > 1 ? ` ×${banner.count}` : ""}
        </b>
        <span className="banner-text">{banner.text}</span>
      </div>
      <button type="button" className="ib sm" aria-label="Dismiss" title="Dismiss" onClick={() => clearBanner(banner.id)}>
        <Icon name="x" small />
      </button>
      {banner.action ? (
        <button
          type="button"
          className="btn primary sm banner-open"
          data-testid="banner-action"
          onClick={() => {
            clearBanner(banner.id);
            banner.action?.run();
          }}
        >
          {banner.action.label}
        </button>
      ) : banner.sessionKey ? (
        <button
          type="button"
          className="btn primary sm banner-open"
          data-testid="banner-open"
          onClick={() => {
            const key = banner.sessionKey as string;
            clearBanner(banner.id);
            onOpen(key);
          }}
        >
          Open
        </button>
      ) : null}
    </div>
  );
}
