export type CanopySqliteFailure = {
  error: Error;
  name?: string;
  code?: string | number;
  errcode?: number;
  errstr?: string;
  cleanupConnection?: number;
  aggregate?: CanopySqliteFailure[];
  cause?: CanopySqliteFailure;
};
export type CanopySqliteResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: CanopySqliteFailure };

export function encodeCanopySqliteFailure(
  error: unknown,
  seen = new Map<Error, CanopySqliteFailure>(),
): CanopySqliteFailure {
  const failure = error instanceof Error ? error : new Error(String(error));
  const existing = seen.get(failure);
  if (existing) {
    return existing;
  }
  // V8 preserves standard Error kinds, but omits AggregateError details and SQLite fields.
  const encoded: CanopySqliteFailure = {
    error: failure,
    name: failure.name,
    ...("code" in failure && (typeof failure.code === "string" || typeof failure.code === "number")
      ? { code: failure.code }
      : {}),
    ...("errcode" in failure && typeof failure.errcode === "number"
      ? { errcode: failure.errcode }
      : {}),
    ...("errstr" in failure && typeof failure.errstr === "string"
      ? { errstr: failure.errstr }
      : {}),
  };
  seen.set(failure, encoded);
  if (failure instanceof AggregateError) {
    encoded.aggregate = failure.errors.map((entry) => encodeCanopySqliteFailure(entry, seen));
  }
  if (failure.cause instanceof Error) {
    encoded.cause = encodeCanopySqliteFailure(failure.cause, seen);
  }
  return encoded;
}

function decodeCanopySqliteFailure(
  failure: CanopySqliteFailure,
  seen = new Map<CanopySqliteFailure, Error>(),
): Error {
  const existing = seen.get(failure);
  if (existing) {
    return existing;
  }
  const error = failure.aggregate ? new AggregateError([], failure.error.message) : failure.error;
  seen.set(failure, error);
  if (failure.name !== undefined) {
    error.name = failure.name;
  }
  if (failure.error.stack !== undefined) {
    error.stack = failure.error.stack;
  }
  Object.assign(error, {
    ...(failure.code === undefined ? {} : { code: failure.code }),
    ...(failure.errcode === undefined ? {} : { errcode: failure.errcode }),
    ...(failure.errstr === undefined ? {} : { errstr: failure.errstr }),
  });
  if (failure.cause) {
    error.cause = decodeCanopySqliteFailure(failure.cause, seen);
  }
  if (failure.aggregate) {
    Object.assign(error, {
      errors: failure.aggregate.map((entry) => decodeCanopySqliteFailure(entry, seen)),
    });
  }
  return error;
}

export function unwrapCanopySqliteResult<T>(result: CanopySqliteResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw decodeCanopySqliteFailure(result.failure);
}
