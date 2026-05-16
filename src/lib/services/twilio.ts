/**
 * Twilio service wrapper (thin shim).
 *
 * Wraps the official `twilio` Node helper library with lazy initialization
 * and normalized error handling. Twilio provides programmable SMS, voice,
 * WhatsApp, and verification (OTP) APIs.
 *
 * Required env vars:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 * Optional env vars:
 *   - TWILIO_PHONE_NUMBER      (default From number for SMS)
 *   - TWILIO_VERIFY_SERVICE_SID (for OTP verification)
 *
 * Usage:
 *   import { twilio } from "@/lib/services/twilio";
 *   await twilio.sendSms({ to: "+1234567890", body: "Your code is 1234" });
 */

import Twilio from "twilio";
import type { Twilio as TwilioClient } from "twilio";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "twilio";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; code?: number } | null;
  const status = e?.status;
  const code = e?.code;

  if (status === 401 || status === 403 || code === 20003) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (status === 404 || code === 20404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  if (status === 429 || code === 20429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, err);
  }
  throw err;
}

export class TwilioService {
  private _client: TwilioClient | null = null;

  get client(): TwilioClient {
    if (!this._client) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: TWILIO_ACCOUNT_SID and/or TWILIO_AUTH_TOKEN",
          ),
        );
      }
      this._client = Twilio(accountSid, authToken);
    }
    return this._client;
  }

  async run<T>(fn: (client: TwilioClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async sendSms(params: { to: string; body: string; from?: string }) {
    return this.run((c) =>
      c.messages.create({
        to: params.to,
        body: params.body,
        from: params.from ?? process.env.TWILIO_PHONE_NUMBER,
      }),
    );
  }

  async sendWhatsApp(params: { to: string; body: string; from?: string }) {
    return this.run((c) =>
      c.messages.create({
        to: `whatsapp:${params.to}`,
        body: params.body,
        from: params.from
          ? `whatsapp:${params.from}`
          : `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      }),
    );
  }

  async sendOtp(to: string) {
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!serviceSid) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing TWILIO_VERIFY_SERVICE_SID for OTP verification"),
      );
    }
    return this.run((c) =>
      c.verify.v2.services(serviceSid).verifications.create({
        to,
        channel: "sms",
      }),
    );
  }

  async verifyOtp(to: string, code: string) {
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!serviceSid) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing TWILIO_VERIFY_SERVICE_SID for OTP verification"),
      );
    }
    return this.run((c) =>
      c.verify.v2.services(serviceSid).verificationChecks.create({
        to,
        code,
      }),
    );
  }

  async makeCall(params: { to: string; from?: string; twiml: string }) {
    return this.run((c) =>
      c.calls.create({
        to: params.to,
        from: params.from ?? process.env.TWILIO_PHONE_NUMBER ?? "",
        twiml: params.twiml,
      }),
    );
  }
}

export const twilio = new TwilioService();
export default twilio;
export { Twilio };
