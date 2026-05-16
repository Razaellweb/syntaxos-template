/**
 * Termii service wrapper (thin shim).
 *
 * Termii is an Africa-focused messaging and OTP verification platform.
 * It provides SMS, WhatsApp, voice, and email channels primarily for
 * OTP delivery, transactional notifications, and customer engagement.
 *
 * Termii does not publish a first-party Node SDK with active maintenance,
 * so this wrapper is built on the platform `fetch` (Node 18+ / Next.js).
 * All requests include `api_key` in the JSON body per the Termii API spec.
 *
 * Required env vars:
 *   - TERMII_API_KEY
 * Optional env vars:
 *   - TERMII_SENDER_ID  (default sender ID for SMS)
 *   - TERMII_BASE_URL   (override; defaults to https://v3.api.termii.com)
 *
 * Usage:
 *   import { termii } from "@/lib/services/termii";
 *   await termii.sendSms({ to: "2348012345678", sms: "Your code is 1234" });
 *   await termii.sendOtp({ phone_number: "2348012345678" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "termii";
const DEFAULT_BASE_URL = "https://v3.api.termii.com";

interface TermiiErrorPayload {
  message?: string;
  errors?: unknown;
  status?: string;
}

function normalizeHttpError(
  status: number,
  payload: TermiiErrorPayload | string,
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
      : payload?.message || JSON.stringify(payload);
  throw new ServiceError(
    `[${PROVIDER}] HTTP ${status}: ${detail || "request failed"}`,
    PROVIDER,
    cause ?? payload,
  );
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

export class TermiiService {
  private _baseUrl: string | null = null;
  private _apiKey: string | null = null;

  private getConfig(): { apiKey: string; baseUrl: string } {
    if (this._apiKey && this._baseUrl) {
      return { apiKey: this._apiKey, baseUrl: this._baseUrl };
    }
    const apiKey = process.env.TERMII_API_KEY;
    if (!apiKey) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env var: TERMII_API_KEY"),
      );
    }
    this._apiKey = apiKey;
    this._baseUrl = (
      process.env.TERMII_BASE_URL || DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    return { apiKey, baseUrl: this._baseUrl };
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { apiKey, baseUrl } = this.getConfig();
    const method = opts.method ?? "POST";
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const bodyWithKey = { ...opts.body, api_key: apiKey };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers, signal: opts.signal };
    if (method !== "GET") {
      init.body = JSON.stringify(bodyWithKey);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      let payload: TermiiErrorPayload | string = "";
      try {
        payload = (await res.json()) as TermiiErrorPayload;
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

  async sendSms<T = unknown>(params: {
    to: string;
    sms: string;
    from?: string;
    channel?: "generic" | "dnd" | "whatsapp";
    type?: "plain";
  }): Promise<T> {
    return this.request<T>("/api/sms/send", {
      body: {
        to: params.to,
        sms: params.sms,
        from: params.from ?? process.env.TERMII_SENDER_ID ?? "N-Alert",
        channel: params.channel ?? "generic",
        type: params.type ?? "plain",
      },
    });
  }

  async sendOtp<T = unknown>(params: {
    phone_number: string;
    message_type?: "NUMERIC" | "ALPHANUMERIC";
    pin_length?: number;
    pin_time_to_live?: number;
    from?: string;
    channel?: "generic" | "dnd" | "whatsapp";
  }): Promise<T> {
    return this.request<T>("/api/sms/otp/send", {
      body: {
        phone_number: params.phone_number,
        from: params.from ?? process.env.TERMII_SENDER_ID ?? "N-Alert",
        message_type: params.message_type ?? "NUMERIC",
        pin_length: params.pin_length ?? 6,
        pin_time_to_live: params.pin_time_to_live ?? 10,
        channel: params.channel ?? "generic",
        pin_placeholder: "< 1234 >",
        message_text: "Your verification code is < 1234 >",
        pin_type: params.message_type ?? "NUMERIC",
      },
    });
  }

  async verifyOtp<T = unknown>(params: {
    pin_id: string;
    pin: string;
  }): Promise<T> {
    return this.request<T>("/api/sms/otp/verify", {
      body: { pin_id: params.pin_id, pin: params.pin },
    });
  }
}

export const termii = new TermiiService();
export default termii;
