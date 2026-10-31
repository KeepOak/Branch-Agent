import { CHIP_FADE, LIST_FADE, scrollOverflow } from './scrollEdges';

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
