import { laterUpdate } from '../settings/level';
import { matchingActions, runAction } from './chatActions';

const handlers = {
  onNewChat: jest.fn(),
  onSettings: jest.fn(),
  onComputer: jest.fn(),
  onAgents: jest.fn(),
  onNeedsYou: jest.fn(),
};

describe('chat search actions', () => {
  it('finds working actions on Regular and unfinished ones only from Advanced', () => {
    expect(matchingActions('settings', 'regular', handlers).map((a) => a.id)).toEqual(['settings']);
    expect(matchingActions('talk', 'regular', handlers)).toEqual([]);
    expect(matchingActions('talk', 'advanced', handlers)).toEqual([
      { id: 'talk', title: 'Talk live', line: laterUpdate('Talk live'), later: true },
    ]);
  });

  it('runs a working action and leaves a later-update row idle', () => {
    const settings = matchingActions('settings', 'regular', handlers)[0];
    runAction(settings, handlers);
    expect(handlers.onSettings).toHaveBeenCalledTimes(1);
    runAction({ id: 'talk', title: 'Talk live', line: laterUpdate('Talk live'), later: true }, handlers);
    expect(handlers.onNewChat).not.toHaveBeenCalled();
  });
});
