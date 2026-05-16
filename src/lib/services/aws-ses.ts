/**
 * AWS SES service wrapper (thin shim).
 *
 * Wraps the official `@aws-sdk/client-ses` with lazy initialization and
 * normalized error handling. Provides transactional and bulk email delivery.
 *
 * Required env vars:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION
 *   - AWS_SES_FROM_EMAIL
 *
 * Usage:
 *   import { ses } from "@/lib/services/aws-ses";
 *   await ses.sendEmail({ to: ["user@example.com"], subject: "Hello", html: "<p>Hi</p>" });
 */

import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  SendBulkTemplatedEmailCommand,
} from "@aws-sdk/client-ses";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "aws-ses";

function normalizeError(err: unknown): never {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = e?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403 || e?.name === "AccessDeniedException") throw new ServiceAuthError(PROVIDER, err);
  if (status === 404 || e?.name === "TemplateDoesNotExistException") throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429 || e?.name === "Throttling") throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.name) throw new ServiceError(`[${PROVIDER}] ${e.name}`, PROVIDER, err);
  throw err;
}

export class AwsSesService {
  private _client: SESClient | null = null;
  private _fromEmail: string | null = null;

  get client(): SESClient {
    if (!this._client) {
      const region = process.env.AWS_REGION;
      if (!region) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: AWS_REGION"));
      }
      this._client = new SESClient({ region });
    }
    return this._client;
  }

  get fromEmail(): string {
    if (!this._fromEmail) {
      this._fromEmail = process.env.AWS_SES_FROM_EMAIL ?? "";
      if (!this._fromEmail) {
        throw new ServiceError(`[${PROVIDER}] missing required env var: AWS_SES_FROM_EMAIL`, PROVIDER);
      }
    }
    return this._fromEmail;
  }

  async sendEmail(params: { to: string[]; subject: string; html?: string; text?: string; from?: string }) {
    try {
      return await this.client.send(
        new SendEmailCommand({
          Source: params.from ?? this.fromEmail,
          Destination: { ToAddresses: params.to },
          Message: {
            Subject: { Data: params.subject },
            Body: {
              ...(params.html ? { Html: { Data: params.html } } : {}),
              ...(params.text ? { Text: { Data: params.text } } : {}),
            },
          },
        }),
      );
    } catch (err) { normalizeError(err); }
  }

  async sendTemplatedEmail(params: { to: string[]; template: string; templateData: Record<string, unknown>; from?: string }) {
    try {
      return await this.client.send(
        new SendTemplatedEmailCommand({
          Source: params.from ?? this.fromEmail,
          Destination: { ToAddresses: params.to },
          Template: params.template,
          TemplateData: JSON.stringify(params.templateData),
        }),
      );
    } catch (err) { normalizeError(err); }
  }
}

export const ses = new AwsSesService();
export default ses;
