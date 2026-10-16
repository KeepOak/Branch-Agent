import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DriveSurface } from './DriveSurface';
import { setTouchMode } from './touch-mode';
import type { RemoteAction } from './remote-action';

const frame = { width: 1280, height: 800 };

beforeEach(() => {
  setTouchMode('touch');
});

describe('DriveSurface', () => {
  it('sends a tap as a click while it is active, and nothing while it is not', async () => {
    const sent: RemoteAction[] = [];
    const idle = await render(
      <DriveSurface active={false} frame={frame} remote={frame} send={(action) => sent.push(action)} typingLabel="Type on this computer">
        <Text>picture</Text>
      </DriveSurface>,
    );
    const idleSurface = idle.getByTestId('drive-surface');
    await fireEvent(idleSurface, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const touch = { identifier: 1, pageX: 320, pageY: 200 };
    await fireEvent(idleSurface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    await fireEvent(idleSurface, 'responderRelease', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    expect(sent).toEqual([]);
  });

  it('sends a tap as a left click at the mapped remote pixel while active', async () => {
    const sent: RemoteAction[] = [];
    const live = await render(
      <DriveSurface active frame={frame} remote={frame} send={(action) => sent.push(action)} typingLabel="Type on this computer">
        <Text>picture</Text>
      </DriveSurface>,
    );
    const surface = live.getByTestId('drive-surface');
    await fireEvent(surface, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const touch = { identifier: 1, pageX: 320, pageY: 200 };
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    await fireEvent(surface, 'responderRelease', { persist: () => undefined, nativeEvent: { ...touch, changedTouches: [touch] } });
    expect(sent).toEqual([{ kind: 'click', x: 640, y: 400, button: 'left' }]);
  });

  it('sends a two-finger move as a scroll while active', async () => {
    const sent: RemoteAction[] = [];
    const live = await render(
      <DriveSurface active frame={frame} remote={frame} send={(action) => sent.push(action)} typingLabel="Type on this computer">
        <Text>picture</Text>
      </DriveSurface>,
    );
    const surface = live.getByTestId('drive-surface');
    await fireEvent(surface, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const a = { identifier: 1, pageX: 200, pageY: 200 };
    const b = { identifier: 2, pageX: 280, pageY: 200 };
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...a, changedTouches: [a] } });
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...b, changedTouches: [b] } });
    const a2 = { identifier: 1, pageX: 200, pageY: 160 };
    const b2 = { identifier: 2, pageX: 280, pageY: 160 };
    await fireEvent(surface, 'responderMove', { persist: () => undefined, nativeEvent: { ...a2, changedTouches: [a2, b2] } });
    expect(sent.some((action) => action.kind === 'scroll' && action.dy !== 0)).toBe(true);
  });

  it('shows the Trackpad pointer after a finger moves', async () => {
    setTouchMode('trackpad');
    const view = await render(
      <DriveSurface active frame={frame} remote={frame} send={() => undefined} typingLabel="Type on this computer">
        <Text>picture</Text>
      </DriveSurface>,
    );
    const surface = view.getByTestId('drive-surface');
    await fireEvent(surface, 'layout', { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 400 } } });
    const down = { identifier: 5, pageX: 100, pageY: 100 };
    await fireEvent(surface, 'responderGrant', { persist: () => undefined, nativeEvent: { ...down, changedTouches: [down] } });
    const move = { identifier: 5, pageX: 140, pageY: 100 };
    await fireEvent(surface, 'responderMove', { persist: () => undefined, nativeEvent: { ...move, changedTouches: [move] } });
    expect(view.getByTestId('drive-cursor')).toBeTruthy();
  });
});
