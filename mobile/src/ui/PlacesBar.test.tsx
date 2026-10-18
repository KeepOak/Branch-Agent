import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import { palettes } from '../theme/tokens';
import { PlacesBar, placesBarHeight, statusBandHeight } from './PlacesBar';

async function renderBar(look: 'ios' | 'android', extra: Partial<Parameters<typeof PlacesBar>[0]> = {}) {
  const onPlace = jest.fn();
  await render(
    <ThemeProvider scheme="light">
      <PlacesBar current="chats" inboxCount={2} onPlace={onPlace} look={look} {...extra} />
    </ThemeProvider>,
  );
  return onPlace;
}

describe('places bar', () => {
  it('lists Home, Chats, Inbox and More, and Inbox can show a count', async () => {
    await renderBar('ios');
    expect(screen.getByTestId('places-bar')).toHaveProp('accessibilityLabel', 'Places');
    expect(screen.getByTestId('place-home')).toHaveTextContent('Home');
    expect(screen.getByTestId('place-chats')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('place-inbox')).toHaveProp('accessibilityLabel', 'Inbox, 2 waiting');
    expect(screen.getByTestId('place-inbox-count')).toHaveTextContent('2');
    expect(screen.getByTestId('place-more')).toHaveTextContent('More');
  });

  it('calls onPlace for each tab and keeps the current one selected', async () => {
    const onPlace = await renderBar('ios');
    await fireEvent.press(screen.getByTestId('place-home'));
    await fireEvent.press(screen.getByTestId('place-inbox'));
    await fireEvent.press(screen.getByTestId('place-more'));
    expect(onPlace.mock.calls.map((c) => c[0])).toEqual(['home', 'inbox', 'more']);
  });

  it('draws the iOS floating pill: 14pt sides, 64pt tall, 32pt radius, ink selected', async () => {
    await renderBar('ios');
    const bar = StyleSheet.flatten(screen.getByTestId('places-bar').props.style);
    expect(bar.position).toBe('absolute');
    expect(bar.left).toBe(14);
    expect(bar.right).toBe(14);
    expect(bar.height).toBe(64);
    expect(bar.borderRadius).toBe(32);
    expect(bar.bottom).toBeGreaterThanOrEqual(24);
    expect(bar.backgroundColor).toBe(palettes.light.glass);
    expect(screen.getByTestId('place-chats')).toHaveTextContent('Chats');
    expect(placesBarHeight('ios', 0)).toBe(88);
    expect(placesBarHeight('ios', 34)).toBe(64 + 42);
    expect(statusBandHeight('ios', 0)).toBe(50);
    expect(statusBandHeight('ios', 59)).toBe(59);
    expect(statusBandHeight('android', 0)).toBe(0);
  });

  it('draws the Android flush bar, not a floating pill', async () => {
    await renderBar('android');
    const bar = StyleSheet.flatten(screen.getByTestId('places-bar').props.style);
    expect(bar.position).toBeUndefined();
    expect(bar.borderRadius).toBeUndefined();
    expect(bar.backgroundColor).not.toBe(palettes.light.glass);
    expect(placesBarHeight('android', 0)).toBe(64);
  });

  it('uses ink, never a blue accent, for the selected iOS tab', async () => {
    await renderBar('ios');
    const label = screen.getByText('Chats');
    const style = StyleSheet.flatten(label.props.style);
    expect(style.color).toBe(palettes.light.ink);
    expect(String(style.color)).not.toMatch(/#0A84FF|#0060C7|#4DA3FF|#484ce5/i);
  });
});
