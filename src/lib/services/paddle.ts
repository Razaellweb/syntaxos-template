/**
 * Paddle service wrapper (thin shim).
 *
 * Wraps the official `@paddle/paddle-node-sdk` with lazy initialization and
 * normalized error handling. Paddle is a merchant of record — it handles
 * payments, tax, subscriptions, and compliance on behalf of the seller.
 *
 * The SDK provides a typed client that maps 1:1 to the Paddle Billing API.
 * This wrapper adds the ServiceError normalization layer and convenience
 * shortcuts for the most common operations.
 *
 * Required env vars:
 *   - PADDLE_API_KEY
 * Optional env vars:
 *   - PADDLE_WEBHOOK_SECRET  (for verifyWebhookSignature)
 *   - PADDLE_ENVIRONMENT     ("sandbox" or "production"; defaults to production)
 *
 * Usage:
 *   import { paddle } from "@/lib/services/paddle";
 *   const txn = await paddle.run((c) => c.transactions.create({ items: [...] }));
 */

import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "paddle";

function normalizeError(err: unknown): never {
  const e = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  } | null;
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

export class PaddleService {
  private _client: Paddle | null = null;

  get client(): Paddle {
    if (!this._client) {
      const apiKey = process.env.PADDLE_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: PADDLE_API_KEY"),
        );
      }
      const environment =
        process.env.PADDLE_ENVIRONMENT === "sandbox"
          ? Environment.sandbox
          : Environment.production;
      this._client = new Paddle(apiKey, { environment });
    }
    return this._client;
  }

  async run<T>(fn: (client: Paddle) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret?: string,
  ) {
    const useSecret = secret ?? process.env.PADDLE_WEBHOOK_SECRET;
    if (!useSecret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing PADDLE_WEBHOOK_SECRET; cannot verify webhook"),
      );
    }
    try {
      return this.client.webhooks.unmarshal(rawBody, useSecret, signature);
    } catch (err) {
      throw new ServiceAuthError(PROVIDER, err);
    }
  }
}

export const paddle = new PaddleService();
export default paddle;
export { Paddle, Environment };
