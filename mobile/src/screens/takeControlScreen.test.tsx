import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { fixtureEnvironments } from '../testing/computerFixtures';
import { computerRows } from '../computers/computerList';
import { TakeControlScreen } from './TakeControlScreen';
import { setTouchMode } from '../stage/touch-mode';
import { memoryStore } from '../storage/keyValueStore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { EngineLink } from '../pairing/pairingSession';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const gateway = computerRows({ environments: fixtureEnvironments })[0];

type FakeOpts = {
  snapshot?: () => Promise<unknown> | unknown;
  goal?: { id: string; status: string } | null;
  sessions?: Array<Record<string, unknown>>;
};

function fakeLink(opts: FakeOpts = {}): EngineLink & {
  acts: Array<Record<string, unknown>>;
  browserActs: Array<Record<string, unknown>>;
  goalOps: Array<Record<string, unknown>>;
  snapshots: number;
} {
  const acts: Array<Record<string, unknown>> = [];
  const browserActs: Array<Record<string, unknown>> = [];
  const goalOps: Array<Record<string, unknown>> = [];
  const sessions = opts.sessions ?? [{ key: 'agent:oak:main', agentId: 'oak', hasActiveRun: true, updatedAt: 1 }];
  let tabs: Array<{ targetId: string; title: string; url: string; type: string }> = [];
  let tabSeq = 0;
  const goalStatus = new Map<string, { id: string; status: string }>();
  const link: EngineLink & {
    acts: Array<Record<string, unknown>>;
    browserActs: Array<Record<string, unknown>>;
    goalOps: Array<Record<string, unknown>>;
    snapshots: number;
  } = {
    acts,
    browserActs,
    goalOps,
    snapshots: 0,
    hello: null,
    onEvent: () => () => undefined,
    onConnected: () => () => undefined,
    request: async <T = unknown>(method: string, params?: unknown) => {
      if (method === 'sessions.list') return { sessions } as T;
      if (method === 'agents.list') return fixtureAgents as T;
      if (method === 'sessions.describe') {
        const key = String((params as { key?: string } | undefined)?.key ?? '');
        const row = sessions.find((s) => s.key === key) ?? { key };
        const stored = goalStatus.get(key);
        const fallback = opts.goal === undefined && row.hasActiveRun === true ? { id: 'goal-1', status: 'active' } : opts.goal;
        const goal = stored ?? fallback ?? undefined;
        return { session: { ...row, ...(goal ? { goal } : {}) } } as T;
      }
      if (method === 'sessions.goal.update') {
        const body = (params ?? {}) as Record<string, unknown>;
        goalOps.push(body);
        goalStatus.set(String(body.sessionKey), { id: String(body.goalId), status: body.action === 'pause' ? 'paused' : 'active' });
        return { ok: true } as T;
      }
      if (method === 'browser.request') {
        const p = (params ?? {}) as { path?: string; body?: Record<string, unknown> };
        const path = String(p.path ?? '');
        const body = p.body ?? {};
        if (path === '/') return { running: true } as T;
        if (path === '/tabs') return { tabs } as T;
        if (path === '/tabs/open') {
          const url = String(body.url ?? 'about:blank');
          const id = `tab-${++tabSeq}`;
          tabs = [...tabs, { targetId: id, title: url, url, type: 'page' }];
          return { targetId: id } as T;
        }
        if (path === '/navigate') {
          const id = String(body.targetId ?? '');
          const url = String(body.url ?? '');
          tabs = tabs.map((t) => (t.targetId === id ? { ...t, url, title: url } : t));
          return { ok: true } as T;
        }
        if (path === '/act') {
          browserActs.push(body);
          return { ok: true } as T;
        }
        return {} as T;
      }
      if (method === 'computer.status') return { available: true, configured: true, computerUse: { provider: { generation: 'driver-one' } } } as T;
      const command = (params as { command?: string } | undefined)?.command;
      const body = (params as { params?: Record<string, unknown> } | undefined)?.params ?? {};
      if (method === 'computer.invoke' && command === 'screen.snapshot') {
        if (opts.snapshot) return (await opts.snapshot()) as T;
        link.snapshots += 1;
        return { payload: { format: 'png', base64: 'aa', displayFrameId: 'frame-1', width: 1280, height: 800 } } as T;
      }
      if (method === 'computer.invoke' && command === 'computer.act') {
        acts.push(body);
        return { payload: { ok: true } } as T;
      }
      return {} as T;
    },
  };
  return link;
}

async function renderScreen(link = fakeLink(), extra: Partial<Parameters<typeof TakeControlScreen>[0]> = {}) {
  let n = 0;
  await render(
    <SafeAreaProvider>
      <TakeControlScreen computer={gateway} link={link} newId={() => `id-${++n}`} onBack={() => undefined} {...extra} />
    </SafeAreaProvider>,
  );
  return { link };
}

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, environments: fixtureEnvironments });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen());
  return { session, engine };
}

beforeEach(() => {
  setTouchMode('touch');
});

describe('take-control screen', () => {
  it('shows Touch selected, Take over once the picture is in, and Hand back after you take over', async () => {
    await renderScreen();
    expect(screen.getByTestId('take-control-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('This computer');
    expect(screen.getByTestId('touch-mode-touch')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('touch-mode-trackpad')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
    expect(screen.getByTestId('stage-pane-computer')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    expect(screen.getByTestId('take-over')).toBeOnTheScreen();
    expect(screen.queryByTestId('drive-keyboard')).toBeNull();
    await fireEvent.press(screen.getByTestId('take-over'));
    await eventually(() => expect(screen.getByText('You’re driving · Oak is paused')).toBeOnTheScreen());
    expect(screen.getByTestId('hand-back')).toBeOnTheScreen();
    expect(screen.getByText('Hand back to Oak')).toBeOnTheScreen();
    expect(screen.getByTestId('drive-keyboard')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('touch-mode-trackpad'));
    expect(screen.getByTestId('drive-keyboard')).toBeOnTheScreen();
    expect(screen.getByTestId('take-control-pill')).toHaveTextContent('You');
    await fireEvent.press(screen.getByTestId('hand-back'));
    expect(screen.getByTestId('take-over')).toBeOnTheScreen();
    expect(screen.queryByTestId('drive-keyboard')).toBeNull();
  });

  it('pauses the Trunk on Take over and resumes it on Hand back', async () => {
    const { link } = await renderScreen();
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('take-over'));
    await eventually(() => expect(link.goalOps.map((op) => op.action)).toEqual(['pause']));
    expect(link.goalOps[0]).toMatchObject({
      sessionKey: 'agent:oak:main',
      agentId: 'oak',
      goalId: 'goal-1',
      action: 'pause',
      note: 'You took over its browser or computer.',
    });
    await fireEvent.press(screen.getByTestId('hand-back'));
    await eventually(() => expect(link.goalOps.map((op) => op.action)).toEqual(['pause', 'resume']));
  });

  it("doesn't claim a pause when the conversation has no Goal to pause", async () => {
    await renderScreen(fakeLink({ goal: null, sessions: [{ key: 'agent:oak:main', agentId: 'oak', updatedAt: 1 }] }));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('take-over'));
    await eventually(() => expect(screen.getByText('You’re driving')).toBeOnTheScreen());
    expect(screen.queryByText(/is paused/)).toBeNull();
    expect(screen.getByTestId('hand-back')).toHaveTextContent('Hand back to Oak');
  });

  it("never resumes a Goal it didn't pause", async () => {
    const { link } = await renderScreen(fakeLink({ goal: { id: 'goal-1', status: 'paused' } }));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('take-over'));
    await eventually(() => expect(screen.getByText('You’re driving')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('hand-back'));
    await eventually(() => expect(screen.getByTestId('take-over')).toBeOnTheScreen());
    expect(link.goalOps).toEqual([]);
  });

  it('switches to Trackpad from the floating pill, in both Computer and Browser', async () => {
    await renderScreen();
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    expect(screen.getByTestId('touch-mode-switch')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('touch-mode-trackpad'));
    expect(screen.getByTestId('touch-mode-trackpad')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('touch-mode-touch')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
    await fireEvent.press(screen.getByTestId('stage-pane-browser'));
    await eventually(() => expect(screen.getByTestId('browser-address')).toBeOnTheScreen());
    expect(screen.getByTestId('touch-mode-trackpad')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('browser-address')).toHaveProp('placeholder', 'Search or enter an address');
  });

  it('keeps the Touch choice in storage', async () => {
    const store = memoryStore();
    const link = fakeLink();
    await render(
      <SafeAreaProvider>
        <TakeControlScreen computer={gateway} link={link} newId={() => 'n1'} store={store} onBack={() => undefined} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByTestId('touch-mode-trackpad'));
    expect(store.dump()['branch.drive.touchMode']).toBe('trackpad');
  });

  it('leaves Take over until the picture is in, and Try again after a failed snapshot', async () => {
    let allow = false;
    let link: ReturnType<typeof fakeLink>;
    link = fakeLink({
      snapshot: () => {
        if (!allow) throw new Error('no picture');
        link.snapshots += 1;
        return { payload: { format: 'png', base64: 'aa', displayFrameId: 'frame-1', width: 1280, height: 800 } };
      },
    });
    await renderScreen(link);
    await eventually(() => expect(screen.getByTestId('take-control-retry')).toBeOnTheScreen());
    expect(screen.getByText(/Couldn't show this computer's screen/)).toBeOnTheScreen();
    expect(screen.getByTestId('take-over')).toBeDisabled();
    allow = true;
    await fireEvent.press(screen.getByTestId('take-control-retry'));
    await eventually(() => expect(screen.getByTestId('take-control-picture')).toBeOnTheScreen());
    expect(screen.getByTestId('take-over')).toBeEnabled();
  });

  it('opens a page from the address bar and drives clicks through /act only while you have it', async () => {
    const { link } = await renderScreen();
    await fireEvent.press(screen.getByTestId('stage-pane-browser'));
    await eventually(() => expect(screen.getByTestId('browser-address')).toBeOnTheScreen());
    await fireEvent.changeText(screen.getByTestId('browser-address'), 'keepoak.com');
    await fireEvent.press(screen.getByTestId('browser-open'));
    await eventually(() => expect(screen.getByTestId('browser-page')).toBeOnTheScreen());
    expect(screen.getByText('https://keepoak.com')).toBeOnTheScreen();
    await eventually(() => expect(screen.getByText(/You’re driving · Oak is paused/)).toBeOnTheScreen());
    await fireEvent(screen.getByTestId('browser-stage'), 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const surface = screen.getByTestId('drive-surface');
    await fireEvent(surface, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const touch = { identifier: 1, pageX: 320, pageY: 200 };
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    await fireEvent(surface, 'responderRelease', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    await eventually(() => expect(link.browserActs.some((body) => body.kind === 'clickCoords' && body.x === 320 && body.y === 200)).toBe(true));
    expect(screen.getByTestId('drive-keyboard')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('hand-back'));
    const before = link.browserActs.length;
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    await fireEvent(surface, 'responderRelease', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    expect(link.browserActs).toHaveLength(before);
  });

  it('hides unfinished extras instead of later-update copy', async () => {
    await renderScreen();
    expect(screen.queryByText(/comes in a later update/)).toBeNull();
    expect(screen.queryByText('Pause')).toBeNull();
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Terminal')).toBeNull();
  });
});

describe('take-control from Computers', () => {
  it('opens This computer from the list, and back leaves every other screen working', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('computer-button'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('computer-gateway')).toHaveProp('accessibilityRole', 'button');
    await fireEvent.press(screen.getByTestId('computer-gateway'));
    expect(screen.getByTestId('take-control-screen')).toBeOnTheScreen();
    expect(within(screen.getByTestId('take-control-screen')).getByText('This computer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('take-control-back'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(screen.getByText('Your computer')).toBeOnTheScreen();
    expect(screen.getByTestId('unpair')).toBeOnTheScreen();
    session.dispose();
  });
});
