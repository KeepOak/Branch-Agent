import { act, screen } from '@testing-library/react-native';

const hidden = { includeHiddenElements: true } as const;

export function fadeCue(testID: string) {
  return screen.getByTestId(testID, hidden);
}

export function queryFadeCue(testID: string) {
  return screen.queryByTestId(testID, hidden);
}

/** Drive FadeScrollView's measurements so tests can assert the edge fade. */
export async function overflowAt(testID: string, axis: 'x' | 'y', content: number, viewport: number, offset = 0) {
  const box = axis === 'x' ? { width: viewport, height: 40 } : { width: 360, height: viewport };
  const node = screen.getByTestId(testID);
  const onScroll = node.props.onScroll as ((event: object) => void) | undefined;
  if (typeof onScroll !== 'function') {
    throw new Error(`overflowAt: ${testID} has no onScroll (${Object.keys(node.props).join(',')})`);
  }
  const event = {
    persist: () => undefined,
    nativeEvent: {
      contentOffset: { x: axis === 'x' ? offset : 0, y: axis === 'y' ? offset : 0 },
      contentSize: { width: axis === 'x' ? content : box.width, height: axis === 'y' ? content : box.height },
      layoutMeasurement: box,
    },
  };
  await act(async () => {
    onScroll(event);
  });
}
