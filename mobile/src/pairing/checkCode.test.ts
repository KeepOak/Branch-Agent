import { pairingCheckCode as windowCheckCode } from '../../../window/src/shared/pairing-check-code';
import { pairingCheckCode } from './checkCode';

describe('check code', () => {
  it('is the same four characters the computer shows for the request', () => {
    for (const id of ['request-1', '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', 'D1', 'abc', '', '--', 'ZZ-zz_9']) {
      expect(pairingCheckCode(id)).toBe(windowCheckCode(id));
    }
    expect(pairingCheckCode('6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f')).toBe('4E5F');
    expect(pairingCheckCode('request-1')).toBe('EST1');
  });
});
