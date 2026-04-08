/**
 * Paystack service wrapper (thin shim).
 *
 * Self-contained wrapper around `paystack-sdk` (v3.7.0). Exposes the full
 * Paystack class so consumers can call any of its nested resources
 * (transaction, customer, plan, subscription, transfer, etc.) while still
 * benefiting from normalized error handling for the most common failures.
 *
 * The Paystack SDK methods do NOT throw on API errors — they return a union
 * `Promise<Success | { status: false; message: string; data: null }>`. This
 * wrapper provides:
 *   1. Direct access to the underlying `Paystack` instance via `.client`.
 *   2. A `.run()` helper that unwraps the success branch and converts the
 *      failure branch into a normalized SyntaxOS error class.
 *
 * Required env vars:
 *   - PAYSTACK_SECRET_KEY  (server-side only — never expose)
 * Optional env var:
 *   - NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY  (used client-side for inline checkout)
 *
 * Usage:
 *   import { paystack } from "@/lib/services/paystack";
 *   const init = await paystack.run((p) =>
 *     p.transaction.initialize({ email: "u@x.com", amount: 50000 })
 *   );
 *   // init.data.authorization_url
 */

import { Paystack } from "paystack-sdk";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "paystack";

type PaystackFailure = { status: false; message: string; data: null };

function isFailure(value: unknown): value is PaystackFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === false
  );
}

function classifyAndThrow(message: string, original?: unknown): never {
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid key") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("forbidden") ||
    lower.includes("no authorization")
  ) {
    throw new ServiceAuthError(PROVIDER, original ?? new Error(message));
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    throw new ServiceRateLimitError(
      PROVIDER,
      undefined,
      original ?? new Error(message),
    );
  }
  if (lower.includes("not found") || lower.includes("could not find")) {
    throw new ServiceNotFoundError(
      PROVIDER,
      undefined,
      original ?? new Error(message),
    );
  }
  throw original ?? new Error(`[${PROVIDER}] ${message}`);
}

function normalizeAxiosError(err: unknown): never {
  // The SDK uses axios under the hood. Network/HTTP errors that escape the
  // SDK's catch surface here as AxiosError-like shapes.
  const e = err as {
    response?: {
      status?: number;
      data?: { message?: string };
      headers?: Record<string, string | undefined>;
    };
    message?: string;
  } | null;

  const status = e?.response?.status;
  const apiMessage = e?.response?.data?.message ?? e?.message ?? "unknown error";

  if (status === 401 || status === 403) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (status === 429) {
    const retryHeader = e?.response?.headers?.["retry-after"];
    const retryAfter = retryHeader ? parseInt(retryHeader, 10) || undefined : undefined;
    throw new ServiceRateLimitError(PROVIDER, retryAfter, err);
  }
  if (status === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  classifyAndThrow(apiMessage, err);
}

export class PaystackService {
  private _client: Paystack | null = null;

  /** Underlying Paystack instance. Lazily constructed on first access. */
  get client(): Paystack {
    if (!this._client) {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: PAYSTACK_SECRET_KEY"),
        );
      }
      this._client = new Paystack(secret);
    }
    return this._client;
  }

  /**
   * Run a Paystack SDK call and unwrap the response. The success branch is
   * returned as-is. The `{ status: false }` failure branch is converted into a
   * normalized ServiceAuth/RateLimit/NotFound error (or rethrown as a generic
   * Error). Network exceptions are normalized via the same path.
   *
   * @example
   *   const tx = await paystack.run((p) => p.transaction.verify("ref_123"));
   *   // tx is the GetTransactionResponse — failure cases throw
   */
  async run<T>(
    fn: (client: Paystack) => Promise<T | PaystackFailure>,
  ): Promise<Exclude<T, PaystackFailure>> {
    let result: T | PaystackFailure;
    try {
      result = await fn(this.client);
    } catch (err) {
      normalizeAxiosError(err);
    }
    if (isFailure(result!)) {
      classifyAndThrow(result!.message);
    }
    return result! as Exclude<T, PaystackFailure>;
  }

  // ---- Convenience shortcuts for the most common operations ----

  async initializeTransaction(params: {
    email: string;
    amount: number;
    reference?: string;
    callback_url?: string;
    metadata?: Record<string, unknown>;
    currency?: string;
  }) {
    return this.run((p) => p.transaction.initialize(params as never));
  }

  async verifyTransaction(reference: string) {
    return this.run((p) => p.transaction.verify(reference));
  }

  async listTransactions(query?: { perPage?: number; page?: number; status?: string }) {
    return this.run((p) => p.transaction.list(query as never));
  }

  async createCustomer(params: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.run((p) => p.customer.create(params as never));
  }

  async fetchCustomer(emailOrCode: string) {
    return this.run((p) => p.customer.fetch(emailOrCode));
  }

  async createPlan(params: {
    name: string;
    amount: number;
    interval: "daily" | "weekly" | "monthly" | "quarterly" | "biannually" | "annually";
    description?: string;
    currency?: string;
  }) {
    return this.run((p) => p.plan.create(params as never));
  }

  async createSubscription(params: {
    customer: string;
    plan: string;
    authorization?: string;
    start_date?: string;
  }) {
    return this.run((p) => p.subscription.create(params as never));
  }
}

export const paystack = new PaystackService();
export default paystack;
export { Paystack };
