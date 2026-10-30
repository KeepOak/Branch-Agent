import { trunkOf, type Approval, type Trunk } from './approvals';

export type InboxTab = 'needs' | 'finished' | 'history';

export const INBOX_TABS: readonly { id: InboxTab; label: string }[] = [
  { id: 'needs', label: 'Needs you' },
  { id: 'finished', label: 'Finished' },
  { id: 'history', label: 'History' },
];

export type InboxGroup<T extends Approval> = {
  key: string;
  trunk: Trunk;
  items: T[];
};

/** Pending (or answered) items in Trunk order, focused id first when given. Preview p50sInbox. */
export function groupByTrunk<T extends Approval>(items: T[], trunks: Record<string, Trunk>, focusId?: string): InboxGroup<T>[] {
  const sorted = focusId ? [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : items;
  const groups: InboxGroup<T>[] = [];
  const at = new Map<string, number>();
  for (const item of sorted) {
    const key = item.agentId || '_';
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, groups.length);
      groups.push({ key, trunk: trunkOf(item, trunks), items: [item] });
    } else {
      groups[index].items.push(item);
    }
  }
  return groups;
}
