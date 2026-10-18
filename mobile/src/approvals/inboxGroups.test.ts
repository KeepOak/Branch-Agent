import { readApproval } from './approvals';
import { groupByTrunk, INBOX_TABS } from './inboxGroups';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { fixtureAgents } from '../testing/chatFixtures';
import { readAgents } from '../chats/chatList';

const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;
const trunks = Object.fromEntries(readAgents(fixtureAgents).agents);

describe('Inbox groups', () => {
  it('lists Needs you, Finished and History in that order', () => {
    expect(INBOX_TABS.map((t) => t.label)).toEqual(['Needs you', 'Finished', 'History']);
  });

  it('groups waiting requests by Trunk and keeps each Trunk’s order', () => {
    const groups = groupByTrunk([exec, plugin], trunks);
    expect(groups.map((g) => g.trunk.name)).toEqual(['Oak', 'Branch Agent']);
    expect(groups[0].items.map((a) => a.id)).toEqual(['exec-1']);
    expect(groups[1].items.map((a) => a.id)).toEqual(['plugin:mail-1']);
  });

  it('puts the Trunk of a focused request first, then the rest in list order', () => {
    const groups = groupByTrunk([exec, plugin], trunks, 'plugin:mail-1');
    expect(groups.map((g) => g.trunk.name)).toEqual(['Branch Agent', 'Oak']);
    expect(groups[0].items[0].id).toBe('plugin:mail-1');
  });
});
