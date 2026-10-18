import { alertData, chatRowForAlert, parseAlertRoute } from './route';

describe('notification tap routing', () => {
  it('round-trips each screen a notification can open', () => {
    expect(parseAlertRoute(alertData({ screen: 'chat', sessionKey: 'agent:oak:main' }))).toEqual({
      screen: 'chat',
      sessionKey: 'agent:oak:main',
    });
    expect(parseAlertRoute(alertData({ screen: 'approvals', approvalId: 'exec-1' }, 'exec-1'))).toEqual({
      screen: 'approvals',
      approvalId: 'exec-1',
    });
    expect(parseAlertRoute(alertData({ screen: 'approvals' }))).toEqual({ screen: 'approvals' });
    expect(parseAlertRoute({ screen: 'inbox' })).toEqual({ screen: 'approvals' });
    expect(parseAlertRoute(alertData({ screen: 'settings' }))).toEqual({ screen: 'settings' });
  });

  it('opens Needs you from a legacy approval payload that only has the id', () => {
    expect(parseAlertRoute({ approvalId: 'plugin:mail-1' })).toEqual({ screen: 'approvals', approvalId: 'plugin:mail-1' });
  });

  it('ignores a tap with no screen and no approval, and a chat whose sessionKey is not an agent session', () => {
    expect(parseAlertRoute({})).toBeNull();
    expect(parseAlertRoute(undefined)).toBeNull();
    expect(parseAlertRoute({ screen: 'chat', sessionKey: 'main' })).toBeNull();
    expect(parseAlertRoute({ screen: 'chat', sessionKey: 'session:oak' })).toBeNull();
    expect(parseAlertRoute({ screen: 'chat' })).toBeNull();
  });

  it('reuses a Chats row when the session is known, else a stub the chat can still load', () => {
    const known = {
      key: 'agent:oak:main',
      title: 'Oak',
      avatar: 'O',
      preview: 'hi',
      updatedAt: 1,
      working: false,
      unread: false,
      pinned: false,
      needsYou: false,
      room: false,
      archived: false,
      snoozedUntil: null,
      automation: false,
    };
    expect(chatRowForAlert('agent:oak:main', [known])).toBe(known);
    expect(chatRowForAlert('agent:main:new', [known])).toMatchObject({ key: 'agent:main:new', title: 'Chat' });
  });
});
