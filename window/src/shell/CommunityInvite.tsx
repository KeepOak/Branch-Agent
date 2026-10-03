import { useState } from "react";
const KEY = "branch.communityInvitation";
export function CommunityInvite() {
  const [shown, setShown] = useState(() => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || "{}");
      return !c.never && !(c.later > Date.now());
    } catch {
      return true;
    }
  });
  const dismiss = (forever: boolean) => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(forever ? { never: true } : { later: Date.now() + 7 * 86400000 }),
      );
    } catch {
      /* This dismissal still lasts for the open window. */
    }
    setShown(false);
  };
  if (!shown) return null;
  return (
    <section className="community-invite" aria-label="Branch community">
      <b>Come build with us</b>
      <small>
        Ask anything, show what you're making, and see what others are building. Or just say hi.
      </small>
      <div>
        <button className="btn sm primary" disabled title="The community address isn't configured.">
          Join the Branch community
        </button>
        <button className="btn sm" onClick={() => dismiss(false)}>
          Not now
        </button>
        <button className="btn sm ghost" onClick={() => dismiss(true)}>
          Don't show again
        </button>
      </div>
    </section>
  );
}
