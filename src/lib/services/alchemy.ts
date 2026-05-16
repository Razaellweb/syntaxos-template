/**
 * Alchemy service wrapper (thin shim).
 *
 * Wraps the official `alchemy-sdk` with lazy initialization and normalized
 * error handling. Alchemy provides multi-chain blockchain APIs for NFTs,
 * tokens, transactions, and JSON-RPC access across 30+ EVM chains.
 *
 * Required env vars:
 *   - ALCHEMY_API_KEY
 * Optional env vars:
 *   - ALCHEMY_NETWORK (defaults to "eth-mainnet")
 *
 * Usage:
 *   import { alchemy } from "@/lib/services/alchemy";
 *   const nfts = await alchemy.run((sdk) => sdk.nft.getNftsForOwner("0x..."));
 */

import { Alchemy, AlchemySettings, Network } from "alchemy-sdk";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "alchemy";

const NETWORK_MAP: Record<string, Network> = {
  "eth-mainnet": Network.ETH_MAINNET,
  "eth-sepolia": Network.ETH_SEPOLIA,
  "polygon-mainnet": Network.MATIC_MAINNET,
  "arb-mainnet": Network.ARB_MAINNET,
  "opt-mainnet": Network.OPT_MAINNET,
  "base-mainnet": Network.BASE_MAINNET,
};

function normalizeError(err: unknown): never {
  const e = err as { status?: number; code?: number; message?: string } | null;
  const status = e?.status ?? e?.code;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class AlchemyService {
  private _client: Alchemy | null = null;

  get client(): Alchemy {
    if (!this._client) {
      const apiKey = process.env.ALCHEMY_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: ALCHEMY_API_KEY"),
        );
      }
      const networkStr = process.env.ALCHEMY_NETWORK || "eth-mainnet";
      const network = NETWORK_MAP[networkStr] ?? Network.ETH_MAINNET;
      const settings: AlchemySettings = { apiKey, network };
      this._client = new Alchemy(settings);
    }
    return this._client;
  }

  async run<T>(fn: (client: Alchemy) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const alchemy = new AlchemyService();
export default alchemy;
export { Alchemy, Network };
