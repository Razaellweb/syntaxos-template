/**
 * Sentry service wrapper (thin shim).
 *
 * Wraps the official `@sentry/node` SDK with lazy initialization and
 * normalized error handling. Sentry provides error tracking, performance
 * monitoring, session replay, and real-time alerting.
 *
 * Required env vars:
 *   - SENTRY_DSN
 * Optional env vars:
 *   - SENTRY_ENVIRONMENT     (defaults to "production")
 *   - SENTRY_TRACES_SAMPLE_RATE  (0.0 to 1.0; defaults to 0)
 *
 * Usage:
 *   import { sentry } from "@/lib/services/sentry";
 *   sentry.init();
 *   sentry.captureException(new Error("something broke"));
 */

import * as Sentry from "@sentry/node";
import { ServiceAuthError } from "./errors";

const PROVIDER = "sentry";

export class SentryService {
  private _initialized = false;

  init(options?: Sentry.NodeOptions): void {
    if (this._initialized) return;

    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env var: SENTRY_DSN"),
      );
    }

    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? "production",
      tracesSampleRate: parseFloat(
        process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0",
      ),
      ...options,
    });
    this._initialized = true;
  }

  captureException(error: unknown, context?: Record<string, unknown>): string {
    this.init();
    return Sentry.captureException(error, { extra: context });
  }

  captureMessage(message: string, level?: Sentry.SeverityLevel): string {
    this.init();
    return Sentry.captureMessage(message, level);
  }

  setUser(user: Sentry.User | null): void {
    Sentry.setUser(user);
  }

  async flush(timeout?: number): Promise<boolean> {
    return Sentry.flush(timeout);
  }
}

export const sentry = new SentryService();
export default sentry;
export { Sentry };
