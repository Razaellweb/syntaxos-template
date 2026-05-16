/**
 * Fincra service wrapper (thin shim).
 *
 * Wraps the community `fincra-node-sdk` with lazy initialization and
 * normalized error handling. Fincra provides payment infrastructure for
 * fintechs and businesses in Africa — collections, payouts, virtual
 * accounts, currency conversion, and verification.
 *
 * Required env vars:
 *   - FINCRA_PUBLIC_KEY
 *   - FINCRA_PRIVATE_KEY
 * Optional env vars:
 *   - FINCRA_SANDBOX  ("true" to use sandbox; defaults to production)
 *
 * Usage:
 *   import { fincra } from "@/lib/services/fincra";
 *   const va = await fincra.run((c) => c.virtualAccount.createVirtualAccount({...}));
 */

import Fincra from "fincra-node-sdk";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "fincra";

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

export class FincraService {
  private _client: Fincra | null = null;

  get client(): Fincra {
    if (!this._client) {
      const publicKey = process.env.FINCRA_PUBLIC_KEY;
      const privateKey = process.env.FINCRA_PRIVATE_KEY;
      if (!publicKey || !privateKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: FINCRA_PUBLIC_KEY and/or FINCRA_PRIVATE_KEY",
          ),
        );
      }
      const sandbox = process.env.FINCRA_SANDBOX === "true";
      this._client = new Fincra(publicKey, privateKey, { sandbox });
    }
    return this._client;
  }

  async run<T>(fn: (client: Fincra) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const fincra = new FincraService();
export default fincra;
export { Fincra };
