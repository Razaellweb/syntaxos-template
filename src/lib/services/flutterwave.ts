/**
 * Flutterwave service wrapper (thin shim).
 *
 * Wraps the `flutterwave-node-v3` SDK with lazy initialization and
 * normalized error handling. Flutterwave enables payments across Africa
 * via cards, bank transfers, mobile money, and USSD.
 *
 * The SDK authenticates using OAuth2 client credentials (client_id +
 * client_secret) exchanged for a short-lived Bearer token.
 *
 * Required env vars:
 *   - FLUTTERWAVE_CLIENT_ID
 *   - FLUTTERWAVE_CLIENT_SECRET
 * Optional env vars:
 *   - FLUTTERWAVE_ENCRYPTION_KEY  (for direct card charge encryption)
 *
 * Usage:
 *   import { flutterwave } from "@/lib/services/flutterwave";
 *   const tx = await flutterwave.run((c) => c.Transaction.verify({ id: "123" }));
 */

import Flutterwave from "flutterwave-node-v3";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "flutterwave";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number; message?: string } | null;
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

export class FlutterwaveService {
  private _client: Flutterwave | null = null;

  get client(): Flutterwave {
    if (!this._client) {
      const publicKey = process.env.FLUTTERWAVE_CLIENT_ID;
      const secretKey = process.env.FLUTTERWAVE_CLIENT_SECRET;
      if (!publicKey || !secretKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: FLUTTERWAVE_CLIENT_ID and/or FLUTTERWAVE_CLIENT_SECRET",
          ),
        );
      }
      this._client = new Flutterwave(publicKey, secretKey);
    }
    return this._client;
  }

  async run<T>(fn: (client: Flutterwave) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async verifyTransaction(transactionId: string) {
    return this.run((c) => c.Transaction.verify({ id: transactionId }));
  }

  async initiateTransfer(payload: {
    account_bank: string;
    account_number: string;
    amount: number;
    currency: string;
    narration?: string;
    reference?: string;
  }) {
    return this.run((c) => c.Transfer.initiate(payload));
  }

  async createVirtualAccount(payload: {
    email: string;
    bvn: string;
    is_permanent?: boolean;
    tx_ref?: string;
  }) {
    return this.run((c) => c.VirtualAcct.create(payload));
  }
}

export const flutterwave = new FlutterwaveService();
export default flutterwave;
export { Flutterwave };
