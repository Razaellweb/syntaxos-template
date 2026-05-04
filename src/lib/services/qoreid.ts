/**
 * QoreID service wrapper (thin shim).
 *
 * QoreID exposes a REST API at `https://api.qoreid.com` for identity, KYC,
 * biometric, address, business, and asset verification. Authentication is
 * OAuth2 client-credentials: exchange (clientId, secret) for a short-lived
 * Bearer access token, then send it on every subsequent request.
 *
 * QoreID does not publish a first-party Node SDK, so this wrapper is built
 * on the platform `fetch` (Node 18+ / Next.js). It owns four jobs:
 *   1. Caching the access token until shortly before expiry.
 *   2. Transparently re-fetching the token on 401 once per call.
 *   3. Normalising auth / not-found / rate-limit failures into the shared
 *      ServiceError family used by the rest of the template.
 *   4. Exposing typed shortcuts for the most common verifications, plus a
 *      generic `request()` escape hatch for endpoints we haven't typed.
 *
 * Required env vars:
 *   - QOREID_CLIENT_ID
 *   - QOREID_CLIENT_SECRET
 * Optional env vars:
 *   - QOREID_BASE_URL        (override; defaults to https://api.qoreid.com)
 *   - QOREID_WEBHOOK_SECRET  (used by `verifyWebhookSignature`; not needed
 *                             unless you receive webhooks)
 *
 * Usage:
 *   import { qoreid } from "@/lib/services/qoreid";
 *   const result = await qoreid.verifyBvnBasic("95888168924", {
 *     firstname: "Bunch",
 *     lastname: "Dillon",
 *     dob: "1995-07-07",
 *   });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "qoreid";
const DEFAULT_BASE_URL = "https://api.qoreid.com";
// Refresh the token a minute before it expires — accounts for clock skew
// and avoids racing 401s on long-running requests.
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

// ── Public types ────────────────────────────────────────────────────────

/** Common biodata payload shared by most Nigerian-identity endpoints. */
export interface QoreIdBiodata {
  firstname: string;
  lastname: string;
  dob?: string; // YYYY-MM-DD
  phone?: string;
  email?: string;
  gender?: string;
}

/** Body for face-verification endpoints. */
export interface QoreIdFaceVerificationBody {
  idNumber: string;
  photoUrl?: string;
  photoBase64?: string;
  firstname?: string;
  lastname?: string;
}

/** Shape of the `/token` response. Extra fields are tolerated. */
interface QoreIdTokenResponse {
  accessToken: string;
  expiresIn: number; // seconds
  tokenType?: string;
  scope?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

interface RequestOptions {
  /** Default ``"POST"``. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-serialisable request body. Omit for GET. */
  body?: unknown;
  /** Extra headers; overridden by the wrapper for Authorization / CT. */
  headers?: Record<string, string>;
  /** AbortSignal for caller-owned timeout / cancellation. */
  signal?: AbortSignal;
  /**
   * Set true to skip the one-shot 401-retry. Used internally for the token
   * fetch itself so we don't recurse.
   */
  skipAuthRetry?: boolean;
}

// ── Error normalisation ─────────────────────────────────────────────────

interface QoreIdErrorPayload {
  message?: string;
  error?: string;
  code?: string;
  status?: string;
}

function normalizeHttpError(
  status: number,
  payload: QoreIdErrorPayload | string,
  retryAfterHeader: string | null,
  cause?: unknown,
): never {
  if (status === 401 || status === 403) {
    throw new ServiceAuthError(PROVIDER, cause ?? payload);
  }
  if (status === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, cause ?? payload);
  }
  if (status === 429) {
    const retryAfter = retryAfterHeader
      ? parseInt(retryAfterHeader, 10) || undefined
      : undefined;
    throw new ServiceRateLimitError(PROVIDER, retryAfter, cause ?? payload);
  }

  const detail =
    typeof payload === "string"
      ? payload
      : payload?.message || payload?.error || JSON.stringify(payload);
  throw new ServiceError(
    `[${PROVIDER}] HTTP ${status}: ${detail || "request failed"}`,
    PROVIDER,
    cause ?? payload,
  );
}

// ── Implementation ──────────────────────────────────────────────────────

export class QoreIdService {
  private _baseUrl: string | null = null;
  private _credentials: { clientId: string; secret: string } | null = null;
  private _token: CachedToken | null = null;
  // Coalesce concurrent first-token requests so a burst of parallel calls
  // makes one /token round-trip, not N.
  private _tokenInflight: Promise<string> | null = null;

  /** Resolved at first use. Throws ServiceAuthError if env is missing. */
  private getCredentials(): { clientId: string; secret: string; baseUrl: string } {
    if (this._credentials && this._baseUrl) {
      return { ...this._credentials, baseUrl: this._baseUrl };
    }
    const clientId = process.env.QOREID_CLIENT_ID;
    const secret = process.env.QOREID_CLIENT_SECRET;
    if (!clientId || !secret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing required env vars: QOREID_CLIENT_ID and/or QOREID_CLIENT_SECRET",
        ),
      );
    }
    this._credentials = { clientId, secret };
    this._baseUrl = (process.env.QOREID_BASE_URL || DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    return { clientId, secret, baseUrl: this._baseUrl };
  }

  /** Force a fresh token on the next call. Useful after a 401. */
  invalidateToken(): void {
    this._token = null;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, secret, baseUrl } = this.getCredentials();
    const res = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId, secret }),
    });

    if (!res.ok) {
      let payload: QoreIdErrorPayload | string = "";
      try {
        payload = (await res.json()) as QoreIdErrorPayload;
      } catch {
        try {
          payload = await res.text();
        } catch {
          /* ignore */
        }
      }
      normalizeHttpError(res.status, payload, res.headers.get("retry-after"));
    }

    const json = (await res.json()) as Partial<QoreIdTokenResponse>;
    if (!json.accessToken) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          `qoreid /token returned no accessToken (payload=${JSON.stringify(json)})`,
        ),
      );
    }
    const expiresInSec = typeof json.expiresIn === "number" ? json.expiresIn : 3600;
    this._token = {
      accessToken: json.accessToken,
      expiresAtMs: Date.now() + expiresInSec * 1000 - TOKEN_REFRESH_LEEWAY_MS,
    };
    return json.accessToken;
  }

  private async getAccessToken(): Promise<string> {
    if (this._token && this._token.expiresAtMs > Date.now()) {
      return this._token.accessToken;
    }
    if (this._tokenInflight) return this._tokenInflight;
    this._tokenInflight = this.fetchToken().finally(() => {
      this._tokenInflight = null;
    });
    return this._tokenInflight;
  }

  /**
   * Generic authenticated request against the QoreID API. All convenience
   * methods funnel through here. `path` is appended to the base URL; do
   * NOT include the host. Errors are already normalised on throw.
   *
   * @example
   *   const out = await qoreid.request<{ status: string }>(
   *     "/v1/ng/identities/nin/12345678901",
   *     { method: "POST", body: { firstname: "A", lastname: "B" } },
   *   );
   */
  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { baseUrl } = this.getCredentials();
    const method = opts.method ?? "POST";
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const doFetch = async (): Promise<Response> => {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.headers || {}),
      };
      const init: RequestInit = { method, headers, signal: opts.signal };
      if (opts.body !== undefined && method !== "GET") {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        init.body =
          typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      }
      return fetch(url, init);
    };

    let res = await doFetch();

    // One-shot retry on 401 in case the cached token was revoked or the
    // server clock-skew estimate was wrong. We only retry once to avoid an
    // infinite loop if the credentials are genuinely bad.
    if (res.status === 401 && !opts.skipAuthRetry) {
      this.invalidateToken();
      res = await doFetch();
    }

    if (!res.ok) {
      let payload: QoreIdErrorPayload | string = "";
      try {
        payload = (await res.json()) as QoreIdErrorPayload;
      } catch {
        try {
          payload = await res.text();
        } catch {
          /* ignore */
        }
      }
      normalizeHttpError(res.status, payload, res.headers.get("retry-after"));
    }

    // 204 / empty body → return undefined cast to T so callers can opt into
    // the void-shape without a runtime parse error.
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some QoreID endpoints (rare) return text/plain. Surface as-is.
      return text as unknown as T;
    }
  }

  // ── Identity verifications (Nigeria) ────────────────────────────

  /** Verify a Bank Verification Number against NIBSS records (basic tier). */
  async verifyBvnBasic<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(`/v1/ng/identities/bvn-basic/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  /** Verify a Bank Verification Number against NIBSS records (premium tier). */
  async verifyBvnPremium<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(`/v1/ng/identities/bvn-premium/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  /** Verify a National Identity Number through NIMC. */
  async verifyNin<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(`/v1/ng/identities/nin/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  /** Verify a Virtual NIN (vNIN). */
  async verifyVNin<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(`/v1/ng/identities/vnin/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  /** Verify a driver's licence number. */
  async verifyDriversLicense<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(
      `/v1/ng/identities/drivers-license/${encodeURIComponent(idNumber)}`,
      { method: "POST", body },
    );
  }

  /** Verify a voter's card. */
  async verifyVotersCard<T = unknown>(idNumber: string, body: QoreIdBiodata): Promise<T> {
    return this.request<T>(`/v1/ng/identities/vc/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  /** Verify an international passport. */
  async verifyInternationalPassport<T = unknown>(
    idNumber: string,
    body: QoreIdBiodata,
  ): Promise<T> {
    return this.request<T>(`/v1/ng/identities/passport/${encodeURIComponent(idNumber)}`, {
      method: "POST",
      body,
    });
  }

  // ── Biometrics ──────────────────────────────────────────────────

  /**
   * Compare a selfie image to the photo on file for a given ID type
   * (e.g. ``bvn``, ``nin``). The body must include the ID number plus
   * either ``photoUrl`` or ``photoBase64`` per the QoreID docs.
   */
  async verifyFaceMatch<T = unknown>(
    idType: string,
    body: QoreIdFaceVerificationBody,
  ): Promise<T> {
    return this.request<T>(
      `/v1/ng/identities/face-verification/${encodeURIComponent(idType)}`,
      { method: "POST", body },
    );
  }

  /** Liveness detection on a customer-supplied selfie. */
  async livenessCheck<T = unknown>(body: { photoUrl?: string; photoBase64?: string }): Promise<T> {
    return this.request<T>("/v1/liveness", { method: "POST", body });
  }

  // ── Webhook signature verification ──────────────────────────────

  /**
   * Verify an inbound webhook request signature.
   *
   * QoreID signs webhook bodies with HMAC-SHA512 of the raw body using your
   * webhook secret, sent in the ``x-qoreid-signature`` header (some legacy
   * webhooks use ``x-webhook-signature``). Constant-time comparison is used
   * to defeat timing attacks.
   *
   * Pass the RAW request body bytes — not a parsed JSON object — or the
   * computed digest will not match.
   */
  async verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string | null | undefined,
    secret?: string,
  ): Promise<boolean> {
    if (!signatureHeader) return false;
    const useSecret = secret ?? process.env.QOREID_WEBHOOK_SECRET;
    if (!useSecret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing QOREID_WEBHOOK_SECRET; cannot verify webhook signature",
        ),
      );
    }

    // crypto is dynamically imported so the wrapper still loads cleanly in
    // edge runtimes that don't ship node:crypto. Webhook handlers are
    // server-only by definition, so this branch only executes there.
    const { createHmac, timingSafeEqual } = await import("node:crypto");

    const bodyBuf =
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
    const expected = createHmac("sha512", useSecret).update(bodyBuf).digest("hex");

    // Strip an optional ``sha512=`` prefix some signers add.
    const provided = signatureHeader.replace(/^sha512=/, "").trim();

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

export const qoreid = new QoreIdService();
export default qoreid;
