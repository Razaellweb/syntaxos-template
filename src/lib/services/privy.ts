/**
 * Privy service wrapper (thin shim).
 *
 * Wraps the official `@privy-io/server-auth` SDK with lazy initialization
 * and normalized error handling. Provides Web3-native authentication with
 * embedded wallets, social login, and token verification.
 *
 * Required env vars:
 *   - PRIVY_APP_ID
 *   - PRIVY_APP_SECRET
 *
 * Usage:
 *   import { privy } from "@/lib/services/privy";
 *   const user = await privy.run((c) => c.getUser("did:privy:..."));
 */

import { PrivyClient } from "@privy-io/server-auth";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "privy";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class PrivyService {
  private _client: PrivyClient | null = null;

  get client(): PrivyClient {
    if (!this._client) {
      const appId = process.env.PRIVY_APP_ID;
      const appSecret = process.env.PRIVY_APP_SECRET;
      if (!appId || !appSecret) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env vars: PRIVY_APP_ID and/or PRIVY_APP_SECRET"),
        );
      }
      this._client = new PrivyClient(appId, appSecret);
    }
    return this._client;
  }

  async run<T>(fn: (client: PrivyClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async verifyAuthToken(token: string) {
    try {
      return await this.client.verifyAuthToken(token);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const privy = new PrivyService();
export default privy;
export { PrivyClient };
