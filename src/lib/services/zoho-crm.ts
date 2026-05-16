/**
 * Zoho CRM service wrapper (thin shim).
 *
 * Wraps the official `@zohocrm/typescript-sdk-7.0` SDK with lazy
 * initialization and normalized error handling. Zoho CRM provides
 * sales automation, lead management, and customer engagement APIs.
 *
 * Required env vars:
 *   - ZOHO_CLIENT_ID
 *   - ZOHO_CLIENT_SECRET
 *   - ZOHO_REFRESH_TOKEN
 * Optional env vars:
 *   - ZOHO_API_DOMAIN  (defaults to https://www.zohoapis.com for US)
 *
 * Usage:
 *   import { zohocrm } from "@/lib/services/zoho-crm";
 *   const leads = await zohocrm.getRecords("Leads");
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "zoho-crm";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";
const TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";

interface ZohoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

function normalizeHttpError(status: number, payload: unknown, cause?: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, cause ?? payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, cause ?? payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, cause ?? payload);
  const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}: ${detail}`, PROVIDER, cause ?? payload);
}

export class ZohoCrmService {
  private _token: CachedToken | null = null;
  private _tokenInflight: Promise<string> | null = null;
  private _credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    apiDomain: string;
  } | null = null;

  private getCredentials() {
    if (this._credentials) return this._credentials;
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and/or ZOHO_REFRESH_TOKEN",
        ),
      );
    }
    this._credentials = {
      clientId,
      clientSecret,
      refreshToken,
      apiDomain: (process.env.ZOHO_API_DOMAIN || DEFAULT_API_DOMAIN).replace(/\/+$/, ""),
    };
    return this._credentials;
  }

  private async fetchAccessToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken } = this.getCredentials();
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: "POST" });
    const json = (await res.json()) as ZohoTokenResponse;
    if (json.error || !json.access_token) {
      throw new ServiceAuthError(PROVIDER, new Error(json.error || "token refresh failed"));
    }
    this._token = {
      accessToken: json.access_token,
      expiresAtMs: Date.now() + (json.expires_in - 60) * 1000,
    };
    return json.access_token;
  }

  private async getAccessToken(): Promise<string> {
    if (this._token && this._token.expiresAtMs > Date.now()) return this._token.accessToken;
    if (this._tokenInflight) return this._tokenInflight;
    this._tokenInflight = this.fetchAccessToken().finally(() => { this._tokenInflight = null; });
    return this._tokenInflight;
  }

  async request<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const { apiDomain } = this.getCredentials();
    const token = await this.getAccessToken();
    const url = `${apiDomain}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: "application/json",
    };
    const init: RequestInit = { method: opts.method ?? "GET", headers };
    if (opts.body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async getRecords<T = unknown>(module: string, params?: Record<string, string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.request<T>(`/crm/v7/${module}${qs}`);
  }

  async createRecord(module: string, data: Record<string, unknown>) {
    return this.request(`/crm/v7/${module}`, { method: "POST", body: { data: [data] } });
  }

  async updateRecord(module: string, id: string, data: Record<string, unknown>) {
    return this.request(`/crm/v7/${module}/${id}`, { method: "PUT", body: { data: [data] } });
  }
}

export const zohocrm = new ZohoCrmService();
export default zohocrm;
