import { useEffect, useState } from "react";
import type { SaplingSession } from "../connect/session";
import type { ThemeChoice } from "../theme/theme";
import { Icon } from "./icons";
import { keyHint } from "./key-hint";
import type { MenuAnchor } from "./Menu";
import { Popover, Segmented, type Above } from "./Popover";
import { versionParts } from "../connect/branch-version";

/** Who is using Branch: users.self's display name, else its first email, else "Owner" (OpenClaw's
 *  ui/src/components/app-sidebar-identity-menu.ts falls back the same way). */
export function readPersonName(result: unknown): string {
  const profile = (result as { profile?: { displayName?: unknown; emails?: unknown } } | null)?.profile;
  const name = typeof profile?.displayName === "string" ? profile.displayName.trim() : "";
  const emails = Array.isArray(profile?.emails) ? profile.emails : [];
  const email = typeof emails[0] === "string" ? emails[0] : "";
  return name || email || "Owner";
}

export function usePersonName(session: SaplingSession, ready: boolean): string {
  const [name, setName] = useState("Owner");
  useEffect(() => {
    if (!ready) {
      return;
    }
    // A local owner connection has no user profile; OpenClaw then shows "Owner" too.
    session.request("users.self", {}).then(
      (r) => setName(readPersonName(r)),
      () => setName("Owner"),
    );
  }, [session, ready]);
  return name;
}

type Props = {
  at: MenuAnchor;
  /** The person row's box: the menu opens above it. */
  above?: Above;
  person: string;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onApps: () => void;
  onAbout: () => void;
  onClose: () => void;
  /** The version waiting to install, when the person hasn't asked to be reminded tomorrow (§4.9.8). */
  updateTo?: string | null;
  onUpdate?: () => void;
  /** Opens the Guide menu: What's new, Set up Branch, the walkthrough, Docs, Get help, Community. */
  onGuide: () => void;
  onReplay: () => void;
  onAddPerson: () => void;
  /** Lock Branch; with no PIN set it opens Settings › Permissions › App lock (§4.1.5, SHARED lockscreen). */
  onLock: () => void;
};

const LOOK: { id: ThemeChoice; name: string }[] = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "system", name: "Auto" },
];

function Row({ icon, label, hint, onClick, testid }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; hint?: string; onClick: () => void; testid?: string }) {
  return (
    <button type="button" className="mi" data-testid={testid} onClick={onClick}>
      <Icon name={icon} small />
      <span className="mi-label">{label}</span>
      {hint ? <span className="mi-hint">{keyHint(hint)}</span> : null}
    </button>
  );
}

/** The person menu (DESIGN-SPEC §4.1.5): who is using Branch, Look, then Settings and help. */
export function PersonMenu(p: Props) {
  const run = (f: () => void) => () => {
    p.onClose();
    f();
  };
  return (
    <Popover at={p.at} above={p.above} onClose={p.onClose} label="Who is using Branch" testid="person-menu" width={280}>
      <div className="ph">Who is using Branch</div>
      <div className="people-row">
        <span className="person current">
          <span className="initial">{p.person.slice(0, 1).toUpperCase()}</span>
          <span>{p.person}</span>
        </span>
        <button type="button" className="person add" data-testid="person-add" onClick={run(p.onAddPerson)}>
          <span className="initial">+</span>
          <span>Add</span>
        </button>
      </div>
      <hr className="msep" />
      <div className="fs-row">
        <span>Look</span>
        <Segmented label="Look" value={p.theme} options={LOOK} onChange={p.onTheme} testid="look" />
      </div>
      <hr className="msep" />
      <Row icon="gear" label="Settings" hint="Ctrl ," onClick={run(p.onSettings)} testid="person-settings" />
      <Row icon="menu" label="Keyboard shortcuts" hint="?" onClick={run(p.onShortcuts)} testid="person-shortcuts" />
      <Row icon="phone" label="Get the apps" onClick={run(p.onApps)} testid="person-apps" />
      <Row icon="help" label="Guide" onClick={run(p.onGuide)} testid="person-guide" />
      {p.updateTo && p.onUpdate ? (
        <button type="button" className="mi" data-testid="person-update" onClick={run(p.onUpdate)}>
          <Icon name="spark" small />
          <span className="mi-label">Update to Branch {versionParts(p.updateTo).short}</span>
          <i className="sb-new" aria-hidden="true" />
        </button>
      ) : null}
      <Row icon="spark" label="Set up Branch" onClick={run(p.onReplay)} testid="person-replay" />
      <Row icon="monitor" label="About Branch" onClick={run(p.onAbout)} />
      <hr className="msep" />
      <Row icon="lock" label="Lock Branch" onClick={run(p.onLock)} testid="person-lock" />
    </Popover>
  );
}
