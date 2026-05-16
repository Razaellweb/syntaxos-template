/**
 * Bitquery service wrapper (thin shim).
 *
 * Bitquery provides GraphQL access to parsed blockchain data across 40+
 * networks including DEX trades, token transfers, and smart contract events.
 * No official SDK — this wrapper uses platform `fetch` with Bearer auth.
 *
 * Required env vars:
 *   - BITQUERY_API_KEY
 *
 * Usage:
 *   import { bitquery } from "@/lib/services/bitquery";
 *   const data = await bitquery.query(`{ ethereum { blocks(limit: {count: 10}) { hash } } }`);
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "bitquery";
const BASE_URL = "https://streaming.bitquery.io/graphql";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class BitqueryService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.BITQUERY_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: BITQUERY_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.getApiKey()}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new ServiceError(
        `[${PROVIDER}] GraphQL errors`,
        PROVIDER,
        json.errors,
      );
    }
    return json.data as T;
  }
}

export const bitquery = new BitqueryService();
export default bitquery;
