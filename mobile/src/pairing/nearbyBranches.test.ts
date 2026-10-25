import { listNearbyBranches, NEARBY_LOOKING, NEARBY_NONE } from './nearbyBranches';

describe('nearby Branches', () => {
  it('does not invent computers: the list is empty until discovery exists', () => {
    expect(listNearbyBranches()).toEqual([]);
    expect(NEARBY_NONE).toMatch(/None found/);
    expect(NEARBY_LOOKING).toMatch(/same network or Tailscale/);
  });
});
