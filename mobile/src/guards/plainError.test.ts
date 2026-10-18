import { CANT_REACH_BRANCH, loadFailure } from '../connect/plainError';
import { formatHits, PLAIN_ERROR_ALLOW_MARK, rawExceptionHits, readMobileFile, srcPaintFiles } from './sourceScan';

describe('plain user-facing errors', () => {
  it('flags error.message, String(err), java.* types and stack text, and skips a marked pairing line', () => {
    expect(rawExceptionHits('setError(error instanceof Error ? error.message : String(error));')).toEqual([
      'error.message',
      'String(error)',
    ]);
    expect(rawExceptionHits('setNote(e instanceof Error ? e.message : String(e));')).toEqual(['e.message', 'String(e)']);
    expect(rawExceptionHits('text = err.stack ?? String(err);')).toEqual(['err.stack', 'String(err)']);
    expect(rawExceptionHits('show(error.stack);')).toEqual(['error.stack']);
    expect(rawExceptionHits('throw new java.lang.IllegalStateException("boom");')).toEqual(['java.lang.IllegalStateException']);
    expect(rawExceptionHits('return fallback;')).toEqual([]);
    expect(rawExceptionHits(`onStatus({ message: error?.message }); // ${PLAIN_ERROR_ALLOW_MARK}: pairing`)).toEqual([]);
  });

  it('maps a failed load to plain words, never the engine text', () => {
    expect(loadFailure({ gatewayCode: 'FORBIDDEN', message: 'missing scope: operator.read' })).toMatch(/Pair it again/);
    expect(loadFailure({ code: 'UNAVAILABLE', message: 'ECONNREFUSED' })).toBe(CANT_REACH_BRANCH);
    expect(loadFailure({ message: 'java.net.SocketTimeoutException' })).toBe(CANT_REACH_BRANCH);
  });

  it('fails if a mobile/src file would render raw exception text', () => {
    const hits = srcPaintFiles().flatMap((file) => {
      const values = rawExceptionHits(readMobileFile(file));
      return values.length ? [formatHits(file, values)] : [];
    });
    expect(hits).toEqual([]);
  });
});
