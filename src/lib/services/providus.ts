/**
 * Providus Bank service wrapper (thin shim).
 *
 * Providus is a Nigerian bank offering banking-as-a-service APIs for
 * virtual account creation, NIP interbank transfers, name enquiry, and
 * BVN validation — all operating on the NIBSS infrastructure.
 *
 * Providus does not publish a first-party Node SDK, so this wrapper is
 * built on the platform `fetch` (Node 18+ / Next.js). It owns three jobs:
 *   1. Generating the HMAC-SHA512 `X-Auth-Signature` from the request body
 *      using the client secret.
 *   2. Normalising HTTP failures into the shared ServiceError family.
 *   3. Exposing typed shortcuts for common operations plus a generic
 *      `request()` escape hatch.
 *
 * Required env vars:
 *   - PROVIDUS_CLIENT_ID
 *   - PROVIDUS_CLIENT_SECRET
 * Optional env vars:
 *   - PROVIDUS_BASE_URL  (override; defaults to https://vps.providusbank.com/vps/api)
 *
 * Usage:
 *   import { providus } from "@/lib/services/providus";
 *   const acct = await providus.createDynamicAccount({
 *     account_name: "John Doe",
 *   });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "providus";
const DEFAULT_BASE_URL = "https://vps.providusbank.com/vps/api";

interface ProvidusErrorPayload {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseCode?: string;
}

function normalizeHttpError(
  status: number,
  payload: ProvidusErrorPayload | string,
  cause?: unknown,
): never {
  if (status === 401 || status === 403) {
    throw new ServiceAuthError(PROVIDER, cause ?? payload);
  }
  if (status === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, cause ?? payload);
  }
  if (status === 429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, cause ?? payload);
  }
  const detail =
    typeof payload === "string"
      ? payload
      : payload?.responseMessage || JSON.stringify(payload);
  throw new ServiceError(
    `[${PROVIDER}] HTTP ${status}: ${detail || "request failed"}`,
    PROVIDER,
    cause ?? payload,
  );
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

export class ProvidusService {
  private _baseUrl: string | null = null;
  private _credentials: { clientId: string; secret: string } | null = null;

  private getCredentials(): { clientId: string; secret: string; baseUrl: string } {
    if (this._credentials && this._baseUrl) {
      return { ...this._credentials, baseUrl: this._baseUrl };
    }
    const clientId = process.env.PROVIDUS_CLIENT_ID;
    const secret = process.env.PROVIDUS_CLIENT_SECRET;
    if (!clientId || !secret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing required env vars: PROVIDUS_CLIENT_ID and/or PROVIDUS_CLIENT_SECRET",
        ),
      );
    }
    this._credentials = { clientId, secret };
    this._baseUrl = (
      process.env.PROVIDUS_BASE_URL || DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    return { clientId, secret, baseUrl: this._baseUrl };
  }

  private async sign(body: string): Promise<string> {
    const { secret } = this.getCredentials();
    const { createHmac } = await import("node:crypto");
    return createHmac("sha512", secret).update(body).digest("hex");
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { clientId, baseUrl } = this.getCredentials();
    const method = opts.method ?? "POST";
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const bodyStr = opts.body ? JSON.stringify(opts.body) : "";
    const signature = await this.sign(bodyStr);

    const headers: Record<string, string> = {
      "Client-Id": clientId,
      "X-Auth-Signature": signature,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers, signal: opts.signal };
    if (bodyStr && method !== "GET") {
      init.body = bodyStr;
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      let payload: ProvidusErrorPayload | string = "";
      try {
        payload = (await res.json()) as ProvidusErrorPayload;
      } catch {
        try {
          payload = await res.text();
        } catch { /* ignore */ }
      }
      normalizeHttpError(res.status, payload);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async createDynamicAccount<T = unknown>(body: { account_name: string }): Promise<T> {
    return this.request<T>("/PiPCreateDynamicAccountNumber", { body });
  }

  async createReservedAccount<T = unknown>(body: {
    account_name: string;
    bvn?: string;
  }): Promise<T> {
    return this.request<T>("/PiPCreateReservedAccountNumber", { body });
  }

  async nipTransfer<T = unknown>(body: {
    beneficiaryAccountName: string;
    beneficiaryAccountNumber: string;
    beneficiaryBank: string;
    transactionAmount: number;
    currencyCode?: string;
    narration?: string;
    transactionReference: string;
  }): Promise<T> {
    return this.request<T>("/NIPFundTransfer", { body });
  }

  async nameEnquiry<T = unknown>(body: {
    accountNumber: string;
    institutionCode: string;
  }): Promise<T> {
    return this.request<T>("/GetNIPAccount", { body });
  }

  async getBalance<T = unknown>(): Promise<T> {
    return this.request<T>("/GetProviderAccountBalance", { method: "GET" });
  }
}

export const providus = new ProvidusService();
export default providus;
