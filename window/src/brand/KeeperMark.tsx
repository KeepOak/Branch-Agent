import { useId } from "react";

/** The approved Keeper small mark, drawn in the surrounding text colour without an app-icon tile. */
export function KeeperMark({ size = 32 }: { size?: number }) {
  const mask = useId();
  return <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="KeepOak Keeper mark">
    <mask id={mask} maskContentUnits="userSpaceOnUse" style={{ maskType: "alpha" }}>
      <image href="/keepoak-mark-mono-white-1024.png" width="1024" height="1024" />
    </mask>
    <rect width="1024" height="1024" fill="currentColor" mask={`url(#${mask})`} />
  </svg>;
}
