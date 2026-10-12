/**
 * Branch's version of upstream ToolOverlay (office/components/ToolOverlay.tsx): the same projected,
 * rAF-refreshed DOM layer, carrying
 *  - a name plate at every Trunk's desk (upstream "Always Show Labels")
 *  - the hover / selected panel: name, role, the live activity with upstream's status dot, tags
 *    (A2A for grafted agents, sub-agent, offline), the needs-you count and upstream's context gauge
 *  - group chat plaques on the meeting-room table (groups have no character; click opens the group)
 */
import { useEffect, useState } from 'react';

import {
  CHARACTER_SITTING_OFFSET_PX,
  CONTEXT_GAUGE_BG,
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_WARN,
  CONTEXT_GAUGE_HEIGHT_PX,
  CONTEXT_GAUGE_WIDTH_PX,
  CONTEXT_WARN_THRESHOLD,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../constants.js';
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js';
import { overlayProjection } from '../office/projection.js';
import { CharacterState, TILE_SIZE } from '../office/types.js';
import { AREA_MEETING, MEETING_TABLE_UID } from './branchLayout.js';
import { namePlateWorldY } from './namePlate.js';
import type { BranchServer } from './branchServer.js';
import type { BranchAgent } from './types.js';

interface Props {
  officeState: OfficeState;
  server: BranchServer;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  showNames: boolean;
  hidden: boolean;
  onOpen: (id: string) => void;
}

const STATE_TEXT: Record<string, string> = {
  working: 'Working',
  reading: 'Reading',
  waiting: 'Waiting for you',
  needs_you: 'Needs your yes',
  resting: 'Resting',
  offline: 'Offline',
};

function dotColor(a: BranchAgent): string | null {
  if ((a.needsYou ?? 0) > 0 || a.state === 'needs_you' || a.state === 'waiting') {
    return 'var(--color-status-permission)';
  }
  if (a.state === 'working' || a.state === 'reading') return 'var(--color-status-active)';
  return null;
}

/** Where the group plaques sit: on the meeting table, else the Meeting area, else the top-left. */
function plaqueAnchor(os: OfficeState): { x: number; y: number } {
  const layout = os.getLayout();
  const table = layout.furniture.find((f) => f.uid === MEETING_TABLE_UID);
  if (table) {
    const e = getCatalogEntry(table.type);
    const w = (e?.footprintW ?? 3) * TILE_SIZE;
    return { x: table.col * TILE_SIZE + w / 2, y: (table.row + 1) * TILE_SIZE + 4 };
  }
  const i = layout.areaTiles?.findIndex((a) => a === AREA_MEETING) ?? -1;
  if (i >= 0) {
    return { x: (i % layout.cols) * TILE_SIZE + TILE_SIZE, y: Math.floor(i / layout.cols) * TILE_SIZE + TILE_SIZE };
  }
  return { x: TILE_SIZE * 3, y: TILE_SIZE * 3 };
}

export function BranchOverlay(p: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setTick((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const el = p.containerRef.current;
  if (!el || p.hidden) return null;
  const os = p.officeState;
  const project = overlayProjection(os.getLayout(), el.getBoundingClientRect(), p.zoom, p.panRef.current, window.devicePixelRatio || 1);
  const cssZoom = p.zoom / (window.devicePixelRatio || 1);
  // Name plates scale with the office (about half a tile tall), within readable limits.
  const nameFont = Math.round(Math.max(9, Math.min(15, cssZoom * 5.5)));

  const furniture = os.getLayout().furniture;
  const footprint = (type: string) => {
    const e = getCatalogEntry(type);
    return e ? { w: e.footprintW, h: e.footprintH } : undefined;
  };

  const items: React.ReactNode[] = [];
  for (const ch of os.characters.values()) {
    if (ch.matrixEffect === 'despawn') continue;
    const sub = ch.isSubagent ? p.subagentCharacters.find((s) => s.id === ch.id) : undefined;
    const ownerNum = ch.isSubagent && ch.parentAgentId !== null ? ch.parentAgentId : ch.id;
    const agent = p.server.agentFor(ownerNum);
    if (!agent) continue;
    const sit = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const x = project.toScreenX(ch.x);
    const hovered = os.hoveredAgentId === ch.id;
    const selected = os.selectedAgentId === ch.id;

    if (p.showNames && !ch.isSubagent && !hovered) {
      items.push(
        <div
          key={`n${ch.id}`}
          className="absolute -translate-x-1/2 pointer-events-none whitespace-nowrap leading-none pa-name"
          data-testid="name-plate"
          data-agent={agent.id}
          style={{
            left: x,
            top: project.toScreenY(namePlateWorldY(ch, os.seats, furniture, footprint, ch.y + sit + 2)),
            opacity: agent.state === 'offline' ? 0.55 : 1,
            fontSize: nameFont,
          }}
        >
          {agent.name.split(/(3)/g).map((part, index) => part === '3' ? <span className="pa-name-three" key={index}>3</span> : part)}
          {agent.kind === 'grafted' && <span className="pa-tag">A2A</span>}
        </div>,
      );
    }

    if (!hovered && !selected) continue;
    const label = ch.isSubagent ? sub?.label || 'Sub-agent' : agent.name;
    const activity = ch.isSubagent
      ? (agent.subagents?.find((s) => `sub:${s.id}` === sub?.parentToolId)?.activity ?? 'Helping ' + agent.name)
      : agent.activity || STATE_TEXT[agent.state];
    const dot = ch.isSubagent ? null : dotColor(agent);
    const ratio = agent.context ? agent.context.used / agent.context.max : 0;
    items.push(
      <div
        key={`t${ch.id}`}
        role="tooltip"
        data-testid="office-tooltip"
        className="absolute flex flex-col items-center pointer-events-none"
        style={{
          left: x,
          top: project.toScreenY(ch.y + sit - TOOL_OVERLAY_VERTICAL_OFFSET) - 8,
          transform: 'translate(-50%, -100%)',
          zIndex: 42,
        }}
      >
        <div className="pixel-panel px-8 pt-2 pb-4 flex flex-col gap-2 whitespace-nowrap max-w-[min(320px,90cqw)]">
          <div className="flex items-center gap-5 leading-none">
            <span className="text-sm text-accent-bright">{label}</span>
            {!ch.isSubagent && agent.role && <span className="text-2xs text-text-muted">{agent.role}</span>}
            {agent.kind === 'grafted' && <span className="pa-tag">A2A</span>}
            {ch.isSubagent && <span className="pa-tag">sub-agent of {agent.name}</span>}
            {!ch.isSubagent && (ch.isTeamLead || ch.agentName) && (
              <span className="pa-tag" style={{ background: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR }}>
                {ch.isTeamLead ? 'LEAD' : ch.agentName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-5 leading-none">
            {dot && (
              <span
                className={`w-6 h-6 rounded-full shrink-0 ${agent.state === 'working' ? 'pixel-pulse' : ''}`}
                style={{ background: dot }}
              />
            )}
            <span className="text-xs overflow-hidden text-ellipsis">{activity}</span>
          </div>
          {!ch.isSubagent && (agent.needsYou ?? 0) > 0 && (
            <span className="text-2xs leading-none" style={{ color: 'var(--color-status-permission)' }}>
              {agent.needsYou} {agent.needsYou === 1 ? 'needs' : 'need'} you
            </span>
          )}
          {agent.context && !ch.isSubagent && (
            <div style={{ width: CONTEXT_GAUGE_WIDTH_PX, height: CONTEXT_GAUGE_HEIGHT_PX, background: CONTEXT_GAUGE_BG }}>
              <div
                style={{
                  width: `${Math.min(ratio * 100, 100)}%`,
                  height: '100%',
                  background: ratio >= CONTEXT_WARN_THRESHOLD ? CONTEXT_GAUGE_COLOR_WARN : CONTEXT_GAUGE_COLOR_OK,
                }}
              />
            </div>
          )}
        </div>
      </div>,
    );
  }

  const groups = p.server.groups();
  if (groups.length) {
    const a = plaqueAnchor(os);
    groups.forEach((g, i) => {
      items.push(
        <button
          key={`g${g.id}`}
          type="button"
          data-testid="group-plaque"
          data-group={g.id}
          className="absolute -translate-x-1/2 pixel-panel px-6 py-1 text-2xs leading-none whitespace-nowrap cursor-pointer pa-plaque"
          style={{ left: project.toScreenX(a.x), top: project.toScreenY(a.y) + i * (nameFont + 9), zIndex: 30, fontSize: nameFont }}
          title={`${g.name}${g.role ? ` · ${g.role}` : ''}. Open the group chat.`}
          onClick={() => p.onOpen(g.id)}
        >
          <span className="pa-tag">Group</span> {g.name}
          {(g.needsYou ?? 0) > 0 && <span className="pa-badge">!{g.needsYou}</span>}
          {g.unread && <span className="pa-dot" />}
        </button>,
      );
    });
  }
  return <>{items}</>;
}
