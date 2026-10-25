import { CANT_REACH_BRANCH, PLAIN_FAILURE, looksRaw, plainError } from './plainError';

const RAW_DUMPS = [
  'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.github.com"',
  'java.net.UnknownHostException: Unable to resolve host "api.github.com": No address associated with hostname',
  'Couldn’t update — fetch failed: java.net.UnknownHostException: Unable to resolve host "api.github.com"',
  'TypeError: Network request failed',
  'Failed to fetch',
  'Error: ECONNREFUSED',
  'socket hang up',
  'at com.facebook.react.modules.network.NetworkModule (NetworkModule.java:42)',
];

describe('plainError', () => {
  it('turns every network dump into the same connection line', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const raw of RAW_DUMPS) {
        expect(looksRaw(raw)).toBe(true);
        expect(plainError(raw)).toBe(CANT_REACH_BRANCH);
        expect(plainError(new Error(raw))).toBe(CANT_REACH_BRANCH);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps already-plain sentences, even when the Error class name looks like a dump', () => {
    expect(plainError('This update didn’t match its checksum. Branch won’t install it.')).toBe(
      'This update didn’t match its checksum. Branch won’t install it.',
    );
    expect(plainError('The engine is busy')).toBe('The engine is busy');
    expect(plainError('sessions unavailable')).toBe('sessions unavailable');
    expect(plainError('history unavailable')).toBe('history unavailable');
    const named = new Error('The engine is busy');
    named.name = 'GatewayProtocolRequestError';
    expect(plainError(named)).toBe('The engine is busy');
  });

  it('uses the fallback for other dumps, and never shows the class name', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(plainError(new SyntaxError('Unexpected token'))).toBe(PLAIN_FAILURE);
      expect(plainError('SyntaxError: Unexpected token')).toBe(PLAIN_FAILURE);
      expect(looksRaw('SyntaxError: Unexpected token')).toBe(true);
      expect(plainError(new SyntaxError('Unexpected token'))).not.toMatch(/SyntaxError/);
    } finally {
      warn.mockRestore();
    }
  });
});
