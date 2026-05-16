/**
 * Doppler service wrapper (thin shim).
 *
 * Doppler provides centralized secrets management. No official Node SDK —
 * this wrapper uses platform `fetch` against the Doppler REST API with
 * Bearer token auth.
 *
 * Required env vars:
 *   - DOPPLER_TOKEN
 *
 * Usage:
 *   import { doppler } from "@/lib/services/doppler";
 *   const secrets = await doppler.getSecrets("production");
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "doppler";
const BASE_URL = "https://api.doppler.com/v3";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class DopplerService {
  private _token: string | null = null;

  private getToken(): string {
    if (!this._token) {
      this._token = process.env.DOPPLER_TOKEN ?? "";
      if (!this._token) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: DOPPLER_TOKEN"));
      }
    }
    return this._token;
  }

  private async request<T = unknown>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getToken()}`,
      Accept: "application/json",
    };
    const init: RequestInit = { method: opts?.method ?? "GET", headers };
    if (opts?.body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async getSecrets<T = unknown>(config: string, project?: string): Promise<T> {
    const qs = new URLSearchParams({ config });
    if (project) qs.set("project", project);
    return this.request<T>(`/configs/config/secrets?${qs.toString()}`);
  }

  async listProjects<T = unknown>(): Promise<T> {
    return this.request<T>("/projects");
  }

  async listConfigs<T = unknown>(project: string): Promise<T> {
    return this.request<T>(`/configs?project=${project}`);
  }
}

export const doppler = new DopplerService();
export default doppler;
