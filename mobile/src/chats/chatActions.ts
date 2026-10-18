import { laterUpdate, levelRank, type ExperienceLevel } from '../settings/level';

/** A Find-anything row under search: Settings or an action, as the preview's PH_ACTIONS / PH_SETS. */
export type ActionHit = {
  id: string;
  title: string;
  line: string;
  later?: boolean;
  run?: 'newChat' | 'settings' | 'computer' | 'agents' | 'needsYou';
};

const ACTIONS: ActionHit[] = [
  { id: 'new-chat', title: 'New chat', line: 'Start or carry on a conversation', run: 'newChat' },
  { id: 'settings', title: 'Settings', line: 'Connection, voice, notifications, privacy', run: 'settings' },
  { id: 'computers', title: 'Computers', line: 'The computer this phone is paired with', run: 'computer' },
  { id: 'agents', title: 'Agents', line: 'Your Trunks on this computer', run: 'agents' },
  { id: 'approvals', title: 'Approvals', line: 'What needs your yes', run: 'needsYou' },
  { id: 'talk', title: 'Talk live', line: 'Talk or dictate', later: true },
  { id: 'scan', title: 'Scan', line: 'Read a receipt or a page with the camera', later: true },
];

export type ActionHandlers = {
  onNewChat?: () => void;
  onSettings?: () => void;
  onComputer?: () => void;
  onAgents?: () => void;
  onNeedsYou?: () => void;
};

function offered(hit: ActionHit, handlers: ActionHandlers): boolean {
  if (hit.later) return true;
  if (hit.run === 'newChat') return Boolean(handlers.onNewChat);
  if (hit.run === 'settings') return Boolean(handlers.onSettings);
  if (hit.run === 'computer') return Boolean(handlers.onComputer);
  if (hit.run === 'agents') return Boolean(handlers.onAgents);
  if (hit.run === 'needsYou') return Boolean(handlers.onNeedsYou);
  return false;
}

/** Actions and settings whose name or line match, Regular hiding unfinished ones. */
export function matchingActions(query: string, level: ExperienceLevel, handlers: ActionHandlers): ActionHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const advanced = levelRank(level) >= 1;
  return ACTIONS.filter((hit) => {
    if (!offered(hit, handlers)) return false;
    if (hit.later && !advanced) return false;
    return `${hit.title} ${hit.line}`.toLowerCase().includes(q);
  }).map((hit) => (hit.later ? { ...hit, line: laterUpdate(hit.title) } : hit));
}

export function runAction(hit: ActionHit, handlers: ActionHandlers): void {
  if (hit.later || !hit.run) return;
  if (hit.run === 'newChat') handlers.onNewChat?.();
  else if (hit.run === 'settings') handlers.onSettings?.();
  else if (hit.run === 'computer') handlers.onComputer?.();
  else if (hit.run === 'agents') handlers.onAgents?.();
  else handlers.onNeedsYou?.();
}
