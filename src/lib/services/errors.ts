/**
 * Shared error classes used by all service wrappers.
 *
 * Wrappers normalize a small set of common failures into these classes so
 * product code can catch them uniformly, regardless of which provider SDK
 * originally threw. Every wrapper file inlines this module's contents at
 * the top so it stays truly single-file-copyable; this file exists only as
 * the canonical source.
 *
 * Normalized cases (per SyntaxOS wrapper contract):
 *   - Authentication failure → ServiceAuthError
 *   - Rate limit exceeded    → ServiceRateLimitError
 *   - Resource not found     → ServiceNotFoundError
 * All other errors pass through unchanged.
 */

export class ServiceError extends Error {
  public readonly provider: string;
  public readonly originalError?: unknown;
  /** HTTP status a route handler should return for this failure.
   *  Use it in catch blocks: `{ status: error.status || 500 }`. */
  public status = 500;

  constructor(message: string, provider: string, originalError?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.provider = provider;
    this.originalError = originalError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ServiceAuthError extends ServiceError {
  constructor(provider: string, originalError?: unknown) {
    super(`[${provider}] authentication failed`, provider, originalError);
    this.name = "ServiceAuthError";
    this.status = 401;
  }
}

export class ServiceRateLimitError extends ServiceError {
  public readonly retryAfterSeconds?: number;

  constructor(
    provider: string,
    retryAfterSeconds?: number,
    originalError?: unknown,
  ) {
    super(`[${provider}] rate limit exceeded`, provider, originalError);
    this.name = "ServiceRateLimitError";
    this.status = 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServiceNotFoundError extends ServiceError {
  public readonly resource?: string;

  constructor(provider: string, resource?: string, originalError?: unknown) {
    super(
      resource
        ? `[${provider}] resource not found: ${resource}`
        : `[${provider}] resource not found`,
      provider,
      originalError,
    );
    this.name = "ServiceNotFoundError";
    this.status = 404;
    this.resource = resource;
  }
}
