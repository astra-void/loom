export function createErrorWithCause(message: string, cause: unknown): Error {
  const wrappedError: Error & { cause?: unknown } = new Error(message);
  wrappedError.cause = cause;
  return wrappedError;
}
