/**
 * Resend service wrapper (thin shim).
 *
 * Self-contained wrapper around the official `resend` SDK. The Resend SDK
 * uses a "no-throw" contract: every method returns `{ data, error, headers }`
 * where exactly one of `data` / `error` is populated. This wrapper exposes:
 *   1. Direct access to the underlying `Resend` instance via `.client`.
 *   2. A `.run()` helper that unwraps the success branch and converts the
 *      `error` branch into a normalized SyntaxOS error class.
 *   3. Convenience methods for the most common operations (sendEmail, etc.).
 *
 * Required env vars:
 *   - RESEND_API_KEY
 * Optional env var:
 *   - RESEND_FROM_EMAIL  (default "from" address used by sendEmail())
 *
 * Usage:
 *   import { resend } from "@/lib/services/resend";
 *   const sent = await resend.sendEmail({
 *     to: "user@example.com",
 *     subject: "Hi",
 *     html: "<p>hello</p>",
 *   });
 *   // sent.id
 */

import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "resend";

const AUTH_ERROR_NAMES = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_access",
]);
const RATE_LIMIT_ERROR_NAMES = new Set([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);
const NOT_FOUND_ERROR_NAMES = new Set(["not_found"]);

function normalizeResendError(error: ErrorResponse): never {
  const name = error.name;
  if (AUTH_ERROR_NAMES.has(name)) {
    throw new ServiceAuthError(PROVIDER, error);
  }
  if (RATE_LIMIT_ERROR_NAMES.has(name)) {
    throw new ServiceRateLimitError(PROVIDER, undefined, error);
  }
  if (NOT_FOUND_ERROR_NAMES.has(name)) {
    throw new ServiceNotFoundError(PROVIDER, undefined, error);
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    throw new ServiceAuthError(PROVIDER, error);
  }
  if (error.statusCode === 429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, error);
  }
  if (error.statusCode === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, error);
  }
  throw new Error(`[${PROVIDER}] ${error.name}: ${error.message}`);
}

function normalizeThrown(err: unknown): never {
  const e = err as { statusCode?: number; name?: string; message?: string } | null;
  if (e && typeof e === "object") {
    if (e.statusCode === 401 || e.statusCode === 403) {
      throw new ServiceAuthError(PROVIDER, err);
    }
    if (e.statusCode === 429) {
      throw new ServiceRateLimitError(PROVIDER, undefined, err);
    }
    if (e.statusCode === 404) {
      throw new ServiceNotFoundError(PROVIDER, undefined, err);
    }
  }
  throw err;
}

export class ResendService {
  private _client: Resend | null = null;

  /** Underlying Resend instance. Lazily constructed on first access. */
  get client(): Resend {
    if (!this._client) {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: RESEND_API_KEY"),
        );
      }
      this._client = new Resend(key);
    }
    return this._client;
  }

  /**
   * Run a Resend SDK call and unwrap the `{data,error}` response. Returns the
   * `data` payload on success; throws a normalized error on failure.
   *
   * @example
   *   const result = await resend.run((r) =>
   *     r.emails.send({ from, to, subject, html })
   *   );
   *   // result.id
   */
  async run<T>(
    fn: (client: Resend) => Promise<{ data: T | null; error: ErrorResponse | null }>,
  ): Promise<T> {
    let response: { data: T | null; error: ErrorResponse | null };
    try {
      response = await fn(this.client);
    } catch (err) {
      normalizeThrown(err);
    }
    if (response!.error) {
      normalizeResendError(response!.error);
    }
    return response!.data as T;
  }

  // ---- Convenience shortcuts ----

  /**
   * Send a transactional email. The `from` field defaults to
   * `process.env.RESEND_FROM_EMAIL` when not provided. Returns the email ID
   * on success and throws a normalized error on failure.
   */
  async sendEmail(
    payload: Omit<CreateEmailOptions, "from"> & { from?: string },
  ): Promise<{ id: string }> {
    const from = payload.from ?? process.env.RESEND_FROM_EMAIL;
    if (!from) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing 'from' address: provide payload.from or set RESEND_FROM_EMAIL",
        ),
      );
    }
    const finalPayload = { ...payload, from } as CreateEmailOptions;
    return this.run((r) => r.emails.send(finalPayload));
  }

  async getEmail(id: string) {
    return this.run((r) => r.emails.get(id));
  }

  async cancelEmail(id: string) {
    return this.run((r) => r.emails.cancel(id));
  }

  async listEmails() {
    return this.run((r) => r.emails.list());
  }

  /** Create a contact in an audience/segment. */
  async createContact(params: { email: string; audienceId: string; firstName?: string; lastName?: string; unsubscribed?: boolean }) {
    return this.run((r) =>
      r.contacts.create({
        email: params.email,
        audienceId: params.audienceId,
        firstName: params.firstName,
        lastName: params.lastName,
        unsubscribed: params.unsubscribed,
      }),
    );
  }
}

export const resend = new ResendService();
export default resend;
export { Resend };
export type { CreateEmailOptions, ErrorResponse };
