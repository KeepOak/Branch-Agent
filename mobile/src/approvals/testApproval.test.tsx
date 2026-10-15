import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { readApproval, trunkOf } from './approvals';
import {
  sendTestApproval,
  TEST_APPROVAL_DESCRIPTION,
  TEST_APPROVAL_PLUGIN,
  TEST_APPROVAL_TIMEOUT_MS,
  TEST_APPROVAL_TITLE,
  TEST_NO_WINDOW_MESSAGE,
  TEST_NOT_ALLOWED_MESSAGE,
  TEST_OFFLINE_MESSAGE,
  testApprovalsOn,
} from './testApproval';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
// The first test pays for compiling the app and the engine's client.
jest.setTimeout(20_000);

async function pairedApp(engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents })) {
  const { session } = createFakeSession(engine);
  const fake = createFakeNotifier('granted');
  const appState = createFakeAppState('active');
  await render(<App scheme="light" session={session} notifier={fake.notifier} appState={appState.source} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen());
  return { session, engine, fake, appState };
}

describe('the way into Approvals', () => {
  it('Chats always has an Approvals button, even with nothing waiting, and it opens Approvals', async () => {
    const { session } = await pairedApp();
    expect(screen.queryByTestId('needs-you-banner')).toBeNull();
    expect(screen.getByTestId('approvals-button')).toHaveProp('accessibilityLabel', 'Approvals, nothing waiting');
    expect(screen.queryByTestId('approvals-button-count')).toBeNull();
    await fireEvent.press(screen.getByTestId('approvals-button'));
    expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen();
    await eventually(() => expect(screen.getByTestId('approvals-empty')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('approvals-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('the count beside Chats opens Approvals while one waits, and the Approvals button shows how many', async () => {
    const { session, engine } = await pairedApp();
    const now = Date.now();
    engine.requestApproval('exec', { id: 'exec-9', createdAtMs: now, expiresAtMs: now + 600_000, request: { command: 'ls', agentId: 'oak', sessionKey: 'agent:oak:chat-1' } });
    await eventually(() => expect(screen.getByTestId('approvals-button-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('approvals-button')).toHaveProp('accessibilityLabel', 'Approvals, 1 waiting');
    expect(screen.getByTestId('chats-count')).toHaveProp('accessibilityLabel', expect.stringContaining('Opens Approvals'));
    await fireEvent.press(screen.getByTestId('chats-count'));
    expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('approval-exec-9')).toBeOnTheScreen();
    session.dispose();
  });

  it('with nothing waiting, the count beside Chats shows the chats it counts', async () => {
    const { session } = await pairedApp();
    expect(screen.getByTestId('chats-count')).toHaveTextContent('2');
    expect(screen.getByTestId('chats-count')).toHaveProp('accessibilityLabel', expect.stringContaining('Shows them'));
    await fireEvent.press(screen.getByTestId('chats-count'));
    expect(screen.getByTestId('filter-unread')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen();
    expect(screen.getByTestId('chat-agent:oak:chat-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-agent:main:old')).toBeNull();
    session.dispose();
  });
});

describe('test approval', () => {
  it('is on in development builds, and in a release only when built with EXPO_PUBLIC_BRANCH_TEST_APPROVALS=1', () => {
    const g = globalThis as { __DEV__?: boolean };
    const dev = g.__DEV__;
    const env = process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS;
    try {
      g.__DEV__ = true;
      delete process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS;
      expect(testApprovalsOn()).toBe(true);
      g.__DEV__ = false;
      expect(testApprovalsOn()).toBe(false);
      process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS = '1';
      expect(testApprovalsOn()).toBe(true);
    } finally {
      g.__DEV__ = dev;
      if (env === undefined) delete process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS;
      else process.env.EXPO_PUBLIC_BRANCH_TEST_APPROVALS = env;
    }
  });

  it('asks the computer for a plugin approval that runs nothing, and names it on its card', async () => {
    const calls: Array<[string, unknown]> = [];
    const link = { hello: {} as never, request: async (method: string, params?: unknown) => (calls.push([method, params]), { status: 'accepted', id: 'plugin:x' }) as never };
    expect(await sendTestApproval(link)).toEqual({ ok: true, id: 'plugin:x' });
    expect(calls).toEqual([
      [
        'plugin.approval.request',
        { pluginId: TEST_APPROVAL_PLUGIN, title: TEST_APPROVAL_TITLE, description: TEST_APPROVAL_DESCRIPTION, severity: 'info', allowedDecisions: ['allow-once', 'deny'], timeoutMs: TEST_APPROVAL_TIMEOUT_MS, twoPhase: true },
      ],
    ]);
    // Within the engine's limits (gateway-protocol plugin-approvals.ts): title 80, description 512, timeout 600000.
    expect(TEST_APPROVAL_TITLE.length).toBeLessThanOrEqual(80);
    expect(TEST_APPROVAL_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(TEST_APPROVAL_TIMEOUT_MS).toBeLessThanOrEqual(600_000);
    const approval = readApproval({ id: 'plugin:x', request: { pluginId: TEST_APPROVAL_PLUGIN, title: TEST_APPROVAL_TITLE, description: TEST_APPROVAL_DESCRIPTION } }, 'plugin')!;
    expect(trunkOf(approval, {})).toEqual({ name: 'Branch test', avatar: '✓' });
  });

  it('says why when the computer has nowhere else to show it, refuses the scope, or is away', async () => {
    const expired = { hello: {} as never, request: async () => ({ id: 'plugin:x', decision: null }) as never };
    expect(await sendTestApproval(expired)).toEqual({ ok: false, message: TEST_NO_WINDOW_MESSAGE });
    const forbidden = { hello: {} as never, request: async () => Promise.reject(Object.assign(new Error('missing scope'), { gatewayCode: 'FORBIDDEN' })) };
    expect(await sendTestApproval(forbidden)).toEqual({ ok: false, message: TEST_NOT_ALLOWED_MESSAGE });
    const away = { hello: null, request: jest.fn() };
    expect(await sendTestApproval(away)).toEqual({ ok: false, message: TEST_OFFLINE_MESSAGE });
    expect(away.request).not.toHaveBeenCalled();
  });

  it('end to end: the test approval reaches this phone, Allow here answers it on the computer', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('approvals-button'));
    await eventually(() => expect(screen.getByTestId('test-approval-card')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('test-approval-send'));
    await eventually(() => expect(screen.getByTestId('approval-plugin:request-1')).toBeOnTheScreen());
    expect(screen.getByTestId('test-approval-sent')).toBeOnTheScreen();
    const card = within(screen.getByTestId('approval-plugin:request-1'));
    expect(card.getByText('Branch test')).toBeOnTheScreen();
    expect(card.getByText(TEST_APPROVAL_TITLE)).toBeOnTheScreen();
    expect(engine.pendingApprovals('plugin').map((a) => a.id)).toEqual(['plugin:request-1']);

    await fireEvent.press(screen.getByTestId('allow-plugin:request-1'));
    await eventually(() => expect(within(screen.getByTestId('answered-plugin:request-1')).getByText('Allowed on this phone')).toBeOnTheScreen());
    expect(engine.requests).toContainEqual({ method: 'plugin.approval.resolve', params: { id: 'plugin:request-1', decision: 'allow-once' } });
    // "Sent. Answer it above" goes once there's nothing left to answer.
    expect(screen.queryByTestId('test-approval-sent')).toBeNull();
    expect(engine.pendingApprovals('plugin')).toEqual([]);
    session.dispose();
  });

  it('the computer can answer it instead, and the phone hears that', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('approvals-button'));
    await fireEvent.press(screen.getByTestId('test-approval-send'));
    await eventually(() => expect(screen.getByTestId('approval-plugin:request-1')).toBeOnTheScreen());
    engine.resolveApproval('plugin:request-1', 'deny');
    await eventually(() => expect(within(screen.getByTestId('answered-plugin:request-1')).getByText('Denied somewhere else')).toBeOnTheScreen());
    session.dispose();
  });

  it('without Branch open on the computer, says so instead of waiting', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    engine.setWindowOpen(false);
    const { session } = await pairedApp(engine);
    await fireEvent.press(screen.getByTestId('approvals-button'));
    await fireEvent.press(screen.getByTestId('test-approval-send'));
    await eventually(() => expect(screen.getByTestId('test-approval-failed')).toHaveTextContent(TEST_NO_WINDOW_MESSAGE));
    expect(screen.queryByTestId('approval-plugin:request-1')).toBeNull();
    session.dispose();
  });

  it('can wait ten seconds first, so the phone can be locked, and the wait can be called off', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('approvals-button'));
    await fireEvent.press(screen.getByTestId('test-approval-later'));
    expect(screen.getByTestId('test-approval-countdown')).toHaveTextContent(/^Sending in 10 s\. Lock the phone now/);
    await fireEvent.press(screen.getByTestId('test-approval-cancel'));
    expect(screen.queryByTestId('test-approval-countdown')).toBeNull();
    expect(engine.requests.some((r) => r.method === 'plugin.approval.request')).toBe(false);
    session.dispose();
  });

  it('sent while Branch is in the background, it posts the notification with Allow and Deny', async () => {
    const { session, engine, fake, appState } = await pairedApp();
    await fireEvent.press(screen.getByTestId('approvals-button'));
    const shown = () => [...fake.shown.values()].find((alert) => alert.approvalId === 'plugin:request-1');
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      await fireEvent.press(screen.getByTestId('test-approval-later'));
      await act(() => appState.set('background'));
      await act(() => jest.advanceTimersByTimeAsync(9_000));
      expect(engine.requests.some((r) => r.method === 'plugin.approval.request')).toBe(false);
      await act(() => jest.advanceTimersByTimeAsync(1_000));
      for (let i = 0; i < 100 && !shown(); i++) await act(() => jest.advanceTimersByTimeAsync(20));
    } finally {
      jest.useRealTimers();
    }
    expect(shown()).toMatchObject({ title: 'Branch test needs a yes' });
    expect(shown()!.category).toBeDefined();
    session.dispose();
  });
});
