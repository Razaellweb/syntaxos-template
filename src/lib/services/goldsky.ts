/**
 * Goldsky service wrapper (thin shim).
 *
 * Goldsky provides managed subgraph hosting and data indexing for blockchain
 * data. This wrapper provides a GraphQL client for querying deployed
 * subgraphs. No official Node SDK — uses platform `fetch`.
 *
 * Required env vars:
 *   - GOLDSKY_API_KEY
 *   - GOLDSKY_SUBGRAPH_ID (the subgraph endpoint path)
 *
 * Usage:
 *   import { goldsky } from "@/lib/services/goldsky";
 *   const data = await goldsky.query(`{ pairs(first: 10) { id token0 { symbol } } }`);
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "goldsky";
const BASE_URL = "https://api.goldsky.com/api/public";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class GoldskyService {
  private _apiKey: string | null = null;
  private _subgraphId: string | null = null;

  private getConfig() {
    if (!this._apiKey) {
      this._apiKey = process.env.GOLDSKY_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: GOLDSKY_API_KEY"),
        );
      }
    }
    if (!this._subgraphId) {
      this._subgraphId = process.env.GOLDSKY_SUBGRAPH_ID ?? "";
    }
    return { apiKey: this._apiKey, subgraphId: this._subgraphId };
  }

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    subgraphId?: string,
  ): Promise<T> {
    const config = this.getConfig();
    const id = subgraphId || config.subgraphId;
    const url = `${BASE_URL}/${id}/subgraphs/${id}/gn`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new ServiceError(`[${PROVIDER}] GraphQL errors`, PROVIDER, json.errors);
    }
    return json.data as T;
  }
}

export const goldsky = new GoldskyService();
export default goldsky;
