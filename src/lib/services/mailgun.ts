/**
 * Mailgun service wrapper (thin shim).
 *
 * Wraps the official `mailgun.js` SDK with lazy initialization and
 * normalized error handling. Mailgun provides email delivery, address
 * validation, inbound routing, and analytics.
 *
 * Required env vars:
 *   - MAILGUN_API_KEY
 *   - MAILGUN_DOMAIN
 * Optional env vars:
 *   - MAILGUN_URL  (override for EU: https://api.eu.mailgun.net)
 *
 * Usage:
 *   import { mailgun } from "@/lib/services/mailgun";
 *   await mailgun.sendEmail({
 *     from: "noreply@mg.example.com",
 *     to: "user@example.com",
 *     subject: "Hello",
 *     text: "World",
 *   });
 */

import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { IMailgunClient } from "mailgun.js/Interfaces";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "mailgun";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;

  if (status === 401 || status === 403) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (status === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  if (status === 429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, err);
  }
  throw err;
}

export class MailgunService {
  private _client: IMailgunClient | null = null;
  private _domain: string | null = null;

  get domain(): string {
    if (!this._domain) {
      this._domain = process.env.MAILGUN_DOMAIN ?? "";
      if (!this._domain) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: MAILGUN_DOMAIN"),
        );
      }
    }
    return this._domain;
  }

  get client(): IMailgunClient {
    if (!this._client) {
      const apiKey = process.env.MAILGUN_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: MAILGUN_API_KEY"),
        );
      }
      const mg = new Mailgun(FormData);
      this._client = mg.client({
        username: "api",
        key: apiKey,
        url: process.env.MAILGUN_URL || "https://api.mailgun.net",
      });
    }
    return this._client;
  }

  async run<T>(fn: (client: IMailgunClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async sendEmail(params: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }) {
    return this.run((c) =>
      c.messages.create(this.domain, params),
    );
  }
}

export const mailgun = new MailgunService();
export default mailgun;
