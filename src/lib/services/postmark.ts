/**
 * Postmark service wrapper (thin shim).
 *
 * Wraps the official `postmark` Node SDK with lazy initialization and
 * normalized error handling. Postmark is a transactional email service
 * focused on delivery speed and reliability.
 *
 * Required env vars:
 *   - POSTMARK_SERVER_TOKEN
 *
 * Usage:
 *   import { postmark } from "@/lib/services/postmark";
 *   await postmark.sendEmail({
 *     From: "noreply@example.com",
 *     To: "user@example.com",
 *     Subject: "Hello",
 *     TextBody: "World",
 *   });
 */

import * as PostmarkLib from "postmark";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "postmark";

function normalizeError(err: unknown): never {
  const e = err as { statusCode?: number; code?: number; message?: string } | null;
  const status = e?.statusCode ?? e?.code;

  if (status === 401 || status === 10) {
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

export class PostmarkService {
  private _client: PostmarkLib.ServerClient | null = null;

  get client(): PostmarkLib.ServerClient {
    if (!this._client) {
      const token = process.env.POSTMARK_SERVER_TOKEN;
      if (!token) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: POSTMARK_SERVER_TOKEN"),
        );
      }
      this._client = new PostmarkLib.ServerClient(token);
    }
    return this._client;
  }

  async run<T>(fn: (client: PostmarkLib.ServerClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async sendEmail(params: PostmarkLib.Models.Message) {
    return this.run((c) => c.sendEmail(params));
  }

  async sendEmailBatch(messages: PostmarkLib.Models.Message[]) {
    return this.run((c) => c.sendEmailBatch(messages));
  }

  async sendEmailWithTemplate(params: PostmarkLib.Models.TemplatedMessage) {
    return this.run((c) => c.sendEmailWithTemplate(params));
  }
}

export const postmark = new PostmarkService();
export default postmark;
export { PostmarkLib };
