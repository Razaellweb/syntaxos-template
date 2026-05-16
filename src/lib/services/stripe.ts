/**
 * Stripe service wrapper (thin shim).
 *
 * Wraps the official `stripe` Node SDK with lazy initialization and
 * normalized error handling.  Exposes the full Stripe client via
 * `.client` and typed shortcuts for common payment flows: creating
 * payment intents, checkout sessions, customer management, subscription
 * CRUD, and webhook signature verification.
 *
 * Required env vars:
 *   - STRIPE_SECRET_KEY
 * Optional env vars:
 *   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  (client-side only)
 *   - STRIPE_WEBHOOK_SECRET               (for verifyWebhookSignature)
 *
 * Usage:
 *   import { stripe } from "@/lib/services/stripe";
 *
 *   const session = await stripe.createCheckoutSession({
 *     lineItems: [{ price: "price_xxx", quantity: 1 }],
 *     successUrl: "https://example.com/success",
 *     cancelUrl: "https://example.com/cancel",
 *   });
 */

import Stripe from "stripe";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "stripe";

function normalizeError(err: unknown): never {
  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (err instanceof Stripe.errors.StripePermissionError) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (err instanceof Stripe.errors.StripeRateLimitError) {
    throw new ServiceRateLimitError(PROVIDER, undefined, err);
  }
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    if (err.statusCode === 404) {
      throw new ServiceNotFoundError(PROVIDER, err.param ?? undefined, err);
    }
  }
  const e = err as { statusCode?: number } | null;
  if (e && typeof e === "object") {
    if (e.statusCode === 401 || e.statusCode === 403) {
      throw new ServiceAuthError(PROVIDER, err);
    }
    if (e.statusCode === 429) {
      throw new ServiceRateLimitError(PROVIDER, undefined, err);
    }
    if (e.statusCode === 404) {
      throw new ServiceNotFoundError(PROVIDER, undefined, err);
    }
  }
  throw err;
}

// ── Public types ────────────────────────────────────────────────────────

export interface CreateCheckoutSessionParams {
  lineItems: Array<{ price: string; quantity: number }>;
  successUrl: string;
  cancelUrl: string;
  mode?: Stripe.Checkout.SessionCreateParams.Mode;
  customerId?: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customerId?: string;
  metadata?: Record<string, string>;
  automaticPaymentMethods?: boolean;
}

// ── Implementation ──────────────────────────────────────────────────────

export class StripeService {
  private _client: Stripe | null = null;

  get client(): Stripe {
    if (!this._client) {
      const apiKey = process.env.STRIPE_SECRET_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: STRIPE_SECRET_KEY"),
        );
      }
      this._client = new Stripe(apiKey);
    }
    return this._client;
  }

  async run<T>(fn: (client: Stripe) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<Stripe.Checkout.Session> {
    return this.run((c) =>
      c.checkout.sessions.create({
        line_items: params.lineItems.map((li) => ({
          price: li.price,
          quantity: li.quantity,
        })),
        mode: params.mode ?? "payment",
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        customer: params.customerId,
        metadata: params.metadata,
      }),
    );
  }

  async createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<Stripe.PaymentIntent> {
    return this.run((c) =>
      c.paymentIntents.create({
        amount: params.amount,
        currency: params.currency,
        customer: params.customerId,
        metadata: params.metadata,
        automatic_payment_methods: params.automaticPaymentMethods !== false
          ? { enabled: true }
          : undefined,
      }),
    );
  }

  async createCustomer(
    params: Stripe.CustomerCreateParams,
  ): Promise<Stripe.Customer> {
    return this.run((c) => c.customers.create(params));
  }

  async createSubscription(
    params: Stripe.SubscriptionCreateParams,
  ): Promise<Stripe.Subscription> {
    return this.run((c) => c.subscriptions.create(params));
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return this.run((c) => c.subscriptions.cancel(subscriptionId));
  }

  async createRefund(
    params: Stripe.RefundCreateParams,
  ): Promise<Stripe.Refund> {
    return this.run((c) => c.refunds.create(params));
  }

  constructWebhookEvent(
    rawBody: string | Buffer,
    signature: string,
    secret?: string,
  ): Stripe.Event {
    const useSecret = secret ?? process.env.STRIPE_WEBHOOK_SECRET;
    if (!useSecret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing STRIPE_WEBHOOK_SECRET; cannot verify webhook signature"),
      );
    }
    try {
      return this.client.webhooks.constructEvent(rawBody, signature, useSecret);
    } catch (err) {
      throw new ServiceAuthError(PROVIDER, err);
    }
  }
}

export const stripe = new StripeService();
export default stripe;
export { Stripe };
