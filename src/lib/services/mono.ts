/**
 * Mono service wrapper (thin shim).
 *
 * Wraps the official `mono-node` SDK with lazy initialization and normalized
 * error handling. Mono provides African open banking APIs for account linking,
 * financial data, and identity verification across 50+ banks.
 *
 * Required env vars:
 *   - MONO_SECRET_KEY
 *
 * Usage:
 *   import { mono } from "@/lib/services/mono";
 *   const account = await mono.getAccountDetails("acc_xxx");
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "mono";
const BASE_URL = "https://api.withmono.com/v2";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class MonoService {
  private _secretKey: string | null = null;

  private getSecretKey(): string {
    if (!this._secretKey) {
      this._secretKey = process.env.MONO_SECRET_KEY ?? "";
      if (!this._secretKey) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: MONO_SECRET_KEY"));
      }
    }
    return this._secretKey;
  }

  private async request<T = unknown>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {
      "mono-sec-key": this.getSecretKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const init: RequestInit = { method: opts?.method ?? "GET", headers };
    if (opts?.body) init.body = JSON.stringify(opts.body);

    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async exchangeToken<T = unknown>(code: string): Promise<T> {
    return this.request<T>("/accounts/auth", { method: "POST", body: { code } });
  }

  async getAccountDetails<T = unknown>(accountId: string): Promise<T> {
    return this.request<T>(`/accounts/${accountId}`);
  }

  async getTransactions<T = unknown>(accountId: string, params?: { start?: string; end?: string; type?: string }): Promise<T> {
    const qs = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : "";
    return this.request<T>(`/accounts/${accountId}/transactions${qs}`);
  }

  async getIdentity<T = unknown>(accountId: string): Promise<T> {
    return this.request<T>(`/accounts/${accountId}/identity`);
  }

  async getStatement<T = unknown>(accountId: string, period: string, output = "json"): Promise<T> {
    return this.request<T>(`/accounts/${accountId}/statement`, {
      method: "POST",
      body: { period, output },
    });
  }
}

export const mono = new MonoService();
export default mono;
