/**
 * QuickNode service wrapper (thin shim).
 *
 * QuickNode provides multi-chain blockchain node endpoints with JSON-RPC
 * and WebSocket access across 25+ chains. No official Node SDK — this
 * wrapper uses platform `fetch` for JSON-RPC calls against the endpoint URL.
 *
 * Required env vars:
 *   - QUICKNODE_ENDPOINT_URL
 *
 * Usage:
 *   import { quicknode } from "@/lib/services/quicknode";
 *   const blockNumber = await quicknode.rpc("eth_blockNumber", []);
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "quicknode";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class QuickNodeService {
  private _endpointUrl: string | null = null;

  private getEndpointUrl(): string {
    if (!this._endpointUrl) {
      this._endpointUrl = process.env.QUICKNODE_ENDPOINT_URL ?? "";
      if (!this._endpointUrl) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: QUICKNODE_ENDPOINT_URL"),
        );
      }
    }
    return this._endpointUrl;
  }

  async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.getEndpointUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (json.error) {
      throw new ServiceError(`[${PROVIDER}] RPC error: ${json.error.message}`, PROVIDER, json.error);
    }
    return json.result as T;
  }

  async getBlockNumber(): Promise<string> {
    return this.rpc<string>("eth_blockNumber");
  }

  async getBalance(address: string, block = "latest"): Promise<string> {
    return this.rpc<string>("eth_getBalance", [address, block]);
  }

  async call(tx: { to: string; data: string }, block = "latest"): Promise<string> {
    return this.rpc<string>("eth_call", [tx, block]);
  }
}

export const quicknode = new QuickNodeService();
export default quicknode;
