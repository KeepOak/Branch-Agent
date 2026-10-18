import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { fadeCue, overflowAt, queryFadeCue } from '../testing/scrollFadeEvents';
import { ThemeProvider } from '../theme/ThemeProvider';
import { palettes } from '../theme/tokens';
import { FadeScrollView } from './ScrollFade';
import { CHIP_FADE, LIST_FADE, scrollOverflow } from './scrollFade';

describe('scroll overflow edges', () => {
  it('treats extra content past the viewport as overflow, with slack for a sub-pixel fit', () => {
    expect(scrollOverflow(200, 200, 0)).toEqual({ overflow: false, moreStart: false, moreEnd: false });
    expect(scrollOverflow(200.4, 200, 0)).toEqual({ overflow: false, moreStart: false, moreEnd: false });
    expect(scrollOverflow(240, 200, 0)).toEqual({ overflow: true, moreStart: false, moreEnd: true });
    expect(scrollOverflow(240, 200, 20)).toEqual({ overflow: true, moreStart: true, moreEnd: true });
    expect(scrollOverflow(240, 200, 40)).toEqual({ overflow: true, moreStart: true, moreEnd: false });
  });

  it('uses the spec-v23 fade widths: 24 on a chip row, 18 on a column', () => {
    expect(CHIP_FADE).toBe(24);
    expect(LIST_FADE).toBe(18);
  });
});

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
});
