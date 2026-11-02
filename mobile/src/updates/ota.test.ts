import { applyQuietJsUpdate } from './ota';

describe('EAS Update', () => {
  it('is a no-op when expo-updates is unconfigured', async () => {
    const checkForUpdateAsync = jest.fn();
    await applyQuietJsUpdate(async () => ({
      isEnabled: false,
      checkForUpdateAsync,
      fetchUpdateAsync: jest.fn(),
    }));
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('swallows a missing or broken expo-updates import', async () => {
    await expect(applyQuietJsUpdate(async () => Promise.reject(new Error('missing')))).resolves.toBeUndefined();
  });
});
