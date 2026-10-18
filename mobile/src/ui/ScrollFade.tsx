import { useCallback, useState } from 'react';
import { View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { NoScrollbarScrollView } from './NoScrollbar';
import { CHIP_FADE, LIST_FADE, scrollOverflow } from './scrollFade';

const STEPS = 10;

function FadeBand({
  axis,
  end,
  color,
  size,
  testID,
}: {
  axis: 'x' | 'y';
  end: boolean;
  color: string;
  size: number;
  testID: string;
}) {
  const horizontal = axis === 'x';
  return (
    <View
      testID={testID}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        position: 'absolute',
        top: horizontal ? 0 : end ? undefined : 0,
        bottom: horizontal ? 0 : end ? 0 : undefined,
        left: horizontal ? (end ? undefined : 0) : 0,
        right: horizontal ? (end ? 0 : undefined) : 0,
        width: horizontal ? size : undefined,
        height: horizontal ? undefined : size,
        flexDirection: horizontal ? 'row' : 'column',
      }}
    >
      {Array.from({ length: STEPS }, (_, i) => {
        const t = end ? i / (STEPS - 1) : 1 - i / (STEPS - 1);
        return <View key={i} style={{ flex: 1, backgroundColor: color, opacity: t }} />;
      })}
    </View>
  );
}

/**
 * Scroll view with the spec-v23 edge fade: a soft wash of the page colour where more
 * content sits past the fold. Never paints a scrollbar.
 */
export function FadeScrollView({
  axis = 'y',
  color,
  fadeSize,
  testID,
  style,
  onScroll,
  onContentSizeChange,
  ...rest
}: ScrollViewProps & {
  axis?: 'x' | 'y';
  color?: string;
  fadeSize?: number;
}) {
  const theme = useTheme();
  const fill = color ?? (axis === 'y' ? theme.color.grouped : theme.color.bg);
  const size = fadeSize ?? (axis === 'x' ? CHIP_FADE : LIST_FADE);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [content, setContent] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const onBox = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox({ w: width, h: height });
  }, []);

  const onSize = useCallback(
    (w: number, h: number) => {
      setContent({ w, h });
      onContentSizeChange?.(w, h);
    },
    [onContentSizeChange],
  );

  const onMove = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { x, y } = event.nativeEvent.contentOffset;
      setOffset({ x, y });
      const measured = event.nativeEvent.layoutMeasurement;
      if (measured) setBox({ w: measured.width, h: measured.height });
      const next = event.nativeEvent.contentSize;
      if (next) setContent({ w: next.width, h: next.height });
      onScroll?.(event);
    },
    [onScroll],
  );

  const along = axis === 'x';
  const edges = scrollOverflow(along ? content.w : content.h, along ? box.w : box.h, along ? offset.x : offset.y);
  const hint = edges.overflow ? (along ? 'Swipe for more filters' : 'Scroll for more') : undefined;

  return (
    <View
      testID={testID ? `${testID}-fade` : undefined}
      onLayout={onBox}
      style={[{ position: 'relative', minWidth: along ? 0 : undefined, flex: along ? undefined : 1 }, style]}
    >
      <NoScrollbarScrollView
        {...rest}
        testID={testID}
        horizontal={along || rest.horizontal}
        style={{ flex: 1 }}
        onContentSizeChange={onSize}
        onScroll={onMove}
        scrollEventThrottle={16}
        accessibilityHint={hint}
      />
      {edges.moreStart ? (
        <FadeBand axis={axis} end={false} color={fill} size={size} testID={testID ? `${testID}-fade-start` : 'scroll-fade-start'} />
      ) : null}
      {edges.moreEnd ? (
        <FadeBand axis={axis} end color={fill} size={size} testID={testID ? `${testID}-fade-end` : 'scroll-fade-end'} />
      ) : null}
    </View>
  );
}
