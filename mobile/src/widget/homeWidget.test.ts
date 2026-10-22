import { readApproval } from '../approvals/approvals';
import { chatForNew, chatRows, readAgents, unreadCount } from '../chats/chatList';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { homeWidgetCopy, parseWidgetAction, routeForWidgetAction } from './homeWidget';

const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const trunks = Object.fromEntries(agents);
const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;

describe('home-screen widget copy', () => {
  it('asks to pair when this phone is not connected', () => {
    expect(homeWidgetCopy({ paired: false, pending: [exec], trunks, rows, now: FIXTURE_NOW })).toEqual({
      title: 'Ask Branch',
      detail: 'Pair this phone with Branch on your computer.',
      counts: '',
      askLabel: 'Ask Branch',
      work: '',
      action: 'open',
    });
  });

  it('shows the oldest approval the way the preview widget does, with waiting and unread counts', () => {
    const copy = homeWidgetCopy({ paired: true, pending: [exec, plugin], trunks, rows, now: FIXTURE_NOW });
    expect(copy).toMatchObject({
      title: 'Oak needs you',
      detail: 'Run a command',
      askLabel: 'Ask Branch',
      work: 'Oak working',
      action: 'approvals',
    });
    expect(copy.counts).toBe(`2 waiting · ${unreadCount(rows, FIXTURE_NOW)} unread`);
  });

  it('says nothing is waiting when Approvals is empty, and still counts unread chats', () => {
    const copy = homeWidgetCopy({ paired: true, pending: [], trunks, rows, now: FIXTURE_NOW });
    expect(copy.title).toBe('Nothing is waiting for you.');
    expect(copy.detail).toBe('Everything is on track.');
    expect(copy.action).toBe('open');
    expect(copy.counts).toBe(`${unreadCount(rows, FIXTURE_NOW)} unread`);
    expect(copy.work).toBe('Oak working');
  });

  it('offers Ask Branch when nothing waits and nothing is unread', () => {
    const quiet = rows.map((row) => ({ ...row, unread: false, needsYou: false, working: false }));
    const copy = homeWidgetCopy({ paired: true, pending: [], trunks, rows: quiet, now: FIXTURE_NOW });
    expect(copy).toMatchObject({
      title: 'Nothing is waiting for you.',
      detail: 'Everything is on track.',
      counts: 'Ask Branch to start a chat',
      work: '',
      action: 'open',
    });
  });
});

describe('home-screen widget taps', () => {
  it('only accepts Ask Branch, open and Approvals', () => {
    expect(parseWidgetAction('ask')).toBe('ask');
    expect(parseWidgetAction('open')).toBe('open');
    expect(parseWidgetAction('approvals')).toBe('approvals');
    expect(parseWidgetAction('voice')).toBeNull();
    expect(parseWidgetAction('')).toBeNull();
    expect(parseWidgetAction(null)).toBeNull();
  });

  it('opens a new chat, Approvals, or Home from the extra the widget sends', () => {
    expect(routeForWidgetAction('approvals', rows, FIXTURE_NOW)).toEqual({ name: 'approvals' });
    expect(routeForWidgetAction('open', rows, FIXTURE_NOW)).toEqual({ name: 'home' });
    expect(routeForWidgetAction('ask', rows, FIXTURE_NOW)).toEqual({ name: 'chat', row: chatForNew(rows, FIXTURE_NOW) });
    expect(routeForWidgetAction('ask', [], FIXTURE_NOW)).toEqual({ name: 'chats' });
  });
});
