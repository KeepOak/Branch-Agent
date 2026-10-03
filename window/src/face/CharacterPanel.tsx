import { useEffect, useState } from "react";
import { Face } from "./Face";
import { STATE_LABEL, type AgentState } from "./agentState";
import { Icon } from "../shell/icons";
import { AGENT_SIZE_PX, useLookPrefs } from "./look-prefs";
import { PRIORITY } from "./cap";
export function CharacterPanel({
  name,
  state,
  onClose,
  others = [],
}: {
  name: string;
  state: AgentState;
  onClose: () => void;
  /** In a room, every other Trunk in it, resting (rooms/, §4.4 "In a room, every member is there"). */
  others?: string[];
}) {
  const [small, setSmall] = useState(false);
  const { agentSize } = useLookPrefs();
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const changed = () => setNarrow(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  return (
    <aside
      className={small ? "character-panel small" : "character-panel"}
      aria-label={`${name}'s activity`}
    >
      <div className={others.length ? "character-panel-row" : undefined} style={others.length ? undefined : { display: "contents" }}>
        {[name, ...others].map((who, i) => {
          const st: AgentState = i === 0 ? state : "idle";
          return (
            <div className="character-panel-body" key={who}>
              <Face size={small ? 44 : narrow ? 56 : AGENT_SIZE_PX[agentSize]} label={who} state={st} priority={i === 0 ? 300 : PRIORITY.row} />
              <div className="character-panel-label">
                <b>{who}</b>
                <small>
                  <i data-state={st} />
                  {STATE_LABEL[st]}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="character-panel-controls">
        <button
          className="ib sm"
          aria-label={small ? "Expand character" : "Minimize character"}
          title={small ? "Expand" : "Minimize"}
          onClick={() => setSmall((v) => !v)}
        >
          <Icon name="chev" small />
        </button>
        <button className="ib sm" aria-label="Hide character" title="Hide" onClick={onClose}>
          <Icon name="x" small />
        </button>
      </div>
    </aside>
  );
}
