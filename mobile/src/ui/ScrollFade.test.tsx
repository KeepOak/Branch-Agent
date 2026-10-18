import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { fadeCue, overflowAt, queryFadeCue } from '../testing/scrollFadeEvents';
import { ThemeProvider } from '../theme/ThemeProvider';
import { palettes } from '../theme/tokens';
import { FadeScrollView } from './ScrollFade';

describe('fade scroll view', () => {
  it('hides both scroll indicators and only paints a fade where more sits past the fold', async () => {
    await render(
      <ThemeProvider scheme="light">
        <FadeScrollView testID="box" color={palettes.light.grouped}>
          <View />
        </FadeScrollView>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('box')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('box')).toHaveProp('showsHorizontalScrollIndicator', false);
    expect(queryFadeCue('box-fade-end')).toBeNull();

    await overflowAt('box', 'y', 400, 200);
    expect(fadeCue('box-fade-end')).toBeOnTheScreen();
    expect(queryFadeCue('box-fade-start')).toBeNull();
    expect(screen.getByTestId('box')).toHaveProp('accessibilityHint', 'Scroll for more');

    await overflowAt('box', 'y', 400, 200, 200);
    expect(fadeCue('box-fade-start')).toBeOnTheScreen();
    expect(queryFadeCue('box-fade-end')).toBeNull();
  });

  it('fades the trailing edge of a horizontal chip row, then the leading edge once scrolled', async () => {
    await render(
      <ThemeProvider scheme="light">
        <FadeScrollView axis="x" testID="chips" color={palettes.light.bg} style={{ flex: 1 }}>
          <View />
        </FadeScrollView>
      </ThemeProvider>,
    );
    await overflowAt('chips', 'x', 480, 200);
    expect(fadeCue('chips-fade-end')).toBeOnTheScreen();
    expect(screen.getByTestId('chips')).toHaveProp('accessibilityHint', 'Swipe for more filters');
    await overflowAt('chips', 'x', 480, 200, 280);
    expect(fadeCue('chips-fade-start')).toBeOnTheScreen();
    expect(queryFadeCue('chips-fade-end')).toBeNull();
  });

  it('keeps a caller’s scrollEventThrottle instead of forcing 16', async () => {
    await render(
      <ThemeProvider scheme="light">
        <FadeScrollView testID="box" scrollEventThrottle={32}>
          <View />
        </FadeScrollView>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('box')).toHaveProp('scrollEventThrottle', 32);
  });
});
