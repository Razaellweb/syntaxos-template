/**
 * Sim (Dune) service wrapper (thin shim).
 *
 * Sim by Dune provides transaction simulation and tracing for EVM chains,
 * enabling developers to simulate transactions before execution and debug
 * reverts. No official SDK — this wrapper uses platform `fetch`.
 *
 * Required env vars:
 *   - SIM_DUNE_API_KEY
 *
 * Usage:
 *   import { simDune } from "@/lib/services/sim-dune";
 *   const result = await simDune.simulate({ chainId: 1, from: "0x...", to: "0x...", data: "0x..." });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "sim-dune";
const BASE_URL = "https://api.sim.dune.com/v1";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export interface SimulateParams {
  chainId: number;
  from: string;
  to: string;
  data?: string;
  value?: string;
  gas?: number;
  blockNumber?: number;
  stateOverrides?: Record<string, unknown>;
}

export class SimDuneService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SIM_DUNE_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SIM_DUNE_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dune-Api-Key": this.getApiKey(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async simulate<T = unknown>(params: SimulateParams): Promise<T> {
    return this.request<T>("/simulate", params);
  }

  async trace<T = unknown>(params: SimulateParams): Promise<T> {
    return this.request<T>("/trace", params);
  }
}

export const simDune = new SimDuneService();
export default simDune;
