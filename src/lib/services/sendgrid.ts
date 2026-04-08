/**
 * SendGrid service wrapper (thin shim).
 *
 * Self-contained wrapper around `@sendgrid/mail`. The SDK ships as a CommonJS
 * singleton (`export = mail`) so under `esModuleInterop` we import it as a
 * default. This wrapper:
 *   1. Lazily configures the singleton with the API key on first use.
 *   2. Normalizes thrown ResponseError objects (which carry an HTTP `.code`)
 *      into ServiceAuth/RateLimit/NotFound errors.
 *   3. Exposes a `.send()` shortcut that returns the parsed message ID and a
 *      `.client` accessor for direct access to the underlying MailService.
 *
 * Required env vars:
 *   - SENDGRID_API_KEY
 * Optional env var:
 *   - SENDGRID_FROM_EMAIL  (default "from" address used by send())
 *
 * Usage:
 *   import { sendgrid } from "@/lib/services/sendgrid";
 *   await sendgrid.send({
 *     to: "user@example.com",
 *     subject: "Hello",
 *     html: "<p>hi</p>",
 *   });
 */

import sgMail from "@sendgrid/mail";
import type { MailDataRequired, ClientResponse } from "@sendgrid/mail";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "sendgrid";

function normalizeError(err: unknown): never {
  // SendGrid throws a `ResponseError` with shape:
  //   { code: number; message: string; response: { headers, body, ... } }
  const e = err as {
    code?: number;
    message?: string;
    response?: { headers?: Record<string, string | undefined>; body?: unknown };
  } | null;

  if (e && typeof e === "object") {
    const code = typeof e.code === "number" ? e.code : undefined;
    if (code === 401 || code === 403) {
      throw new ServiceAuthError(PROVIDER, err);
    }
    if (code === 429) {
      const retryHeader = e.response?.headers?.["retry-after"];
      const retryAfter = retryHeader ? parseInt(retryHeader, 10) || undefined : undefined;
      throw new ServiceRateLimitError(PROVIDER, retryAfter, err);
    }
    if (code === 404) {
      throw new ServiceNotFoundError(PROVIDER, undefined, err);
    }
  }
  throw err;
}

export class SendGridService {
  private _initialized = false;

  private ensureConfigured(): void {
    if (this._initialized) return;
    const key = process.env.SENDGRID_API_KEY;
    if (!key) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env var: SENDGRID_API_KEY"),
      );
    }
    sgMail.setApiKey(key);
    this._initialized = true;
  }

  /** Underlying `@sendgrid/mail` MailService singleton. */
  get client(): typeof sgMail {
    this.ensureConfigured();
    return sgMail;
  }

  /**
   * Send a single email. The `from` field defaults to
   * `process.env.SENDGRID_FROM_EMAIL` when not provided. Returns the parsed
   * `x-message-id` header on success and throws a normalized error on failure.
   */
  async send(
    payload: Omit<MailDataRequired, "from"> & { from?: MailDataRequired["from"] },
  ): Promise<{ statusCode: number; messageId?: string }> {
    this.ensureConfigured();
    const from = payload.from ?? process.env.SENDGRID_FROM_EMAIL;
    if (!from) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing 'from' address: provide payload.from or set SENDGRID_FROM_EMAIL",
        ),
      );
    }
    const finalPayload = { ...payload, from } as MailDataRequired;

    try {
      const [response] = (await sgMail.send(finalPayload)) as [ClientResponse, unknown];
      const headers = (response.headers ?? {}) as Record<string, string | undefined>;
      return {
        statusCode: response.statusCode,
        messageId: headers["x-message-id"],
      };
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Send the same payload to multiple recipients without exposing the list to
   * each recipient. Equivalent to SendGrid's `sendMultiple`.
   */
  async sendMultiple(
    payload: Omit<MailDataRequired, "from"> & { from?: MailDataRequired["from"] },
  ): Promise<{ statusCode: number; messageId?: string }> {
    this.ensureConfigured();
    const from = payload.from ?? process.env.SENDGRID_FROM_EMAIL;
    if (!from) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing 'from' address: provide payload.from or set SENDGRID_FROM_EMAIL",
        ),
      );
    }
    const finalPayload = { ...payload, from } as MailDataRequired;

    try {
      const [response] = (await sgMail.sendMultiple(finalPayload)) as [
        ClientResponse,
        unknown,
      ];
      const headers = (response.headers ?? {}) as Record<string, string | undefined>;
      return {
        statusCode: response.statusCode,
        messageId: headers["x-message-id"],
      };
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const sendgrid = new SendGridService();
export default sendgrid;
export type { MailDataRequired, ClientResponse };
