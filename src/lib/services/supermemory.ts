/**
 * Supermemory service wrapper (thin shim).
 *
 * Supermemory provides AI memory and knowledge management with document
 * ingestion and semantic search. No maintained SDK — this wrapper uses
 * platform `fetch` against the REST API.
 *
 * Required env vars:
 *   - SUPERMEMORY_API_KEY
 *
 * Usage:
 *   import { supermemory } from "@/lib/services/supermemory";
 *   await supermemory.addMemory({ content: "Important context..." });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "supermemory";
const BASE_URL = "https://api.supermemory.ai/v1";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class SupermemoryService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SUPERMEMORY_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SUPERMEMORY_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getApiKey()}`,
      "Content-Type": "application/json",
    };
    const init: RequestInit = { method: opts.method ?? "GET", headers };
    if (opts.body) init.body = JSON.stringify(opts.body);

    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async addMemory<T = unknown>(params: { content: string; metadata?: Record<string, unknown> }): Promise<T> {
    return this.request<T>("/memories", { method: "POST", body: params });
  }

  async search<T = unknown>(query: string, limit = 10): Promise<T> {
    return this.request<T>("/search", { method: "POST", body: { query, limit } });
  }

  async getMemories<T = unknown>(): Promise<T> {
    return this.request<T>("/memories");
  }

  async deleteMemory(id: string): Promise<void> {
    await this.request(`/memories/${id}`, { method: "DELETE" });
  }
}

export const supermemory = new SupermemoryService();
export default supermemory;
