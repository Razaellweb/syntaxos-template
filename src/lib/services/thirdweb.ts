/**
 * Thirdweb service wrapper (thin shim).
 *
 * Wraps the official `thirdweb` SDK with lazy initialization and normalized
 * error handling. Thirdweb provides full-stack Web3 tools: contract deployment,
 * wallet connection, NFT minting, and gasless transactions across EVM chains.
 *
 * Required env vars:
 *   - THIRDWEB_SECRET_KEY
 *
 * Usage:
 *   import { thirdwebClient } from "@/lib/services/thirdweb";
 *   import { getContract } from "thirdweb";
 *   const contract = getContract({ client: thirdwebClient, chain, address });
 */

import { createThirdwebClient, ThirdwebClient } from "thirdweb";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "thirdweb";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class ThirdwebService {
  private _client: ThirdwebClient | null = null;

  get client(): ThirdwebClient {
    if (!this._client) {
      const secretKey = process.env.THIRDWEB_SECRET_KEY;
      if (!secretKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: THIRDWEB_SECRET_KEY"),
        );
      }
      this._client = createThirdwebClient({ secretKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: ThirdwebClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const thirdweb = new ThirdwebService();
export const thirdwebClient = thirdweb.client;
export default thirdweb;
