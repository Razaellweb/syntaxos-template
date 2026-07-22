/**
 * Definitive Flash service wrapper (thin shim).
 *
 * Flash is Definitive's advanced onchain trading API. It exposes a small,
 * stateless REST surface for placing MEV-protected swaps and advanced orders
 * (market, limit, stop, stop-loss, take-profit, TWAP, bracket) that route
 * across 200+ DEXs and market makers on EVM chains and Solana. There is no
 * official npm SDK, so this wrapper uses platform `fetch`.
 *
 * The flow is quote -> sign -> submit:
 *   1. `getQuote()` returns the best route plus a signable payload
 *      (`evm.orderTypedData` / `evm.permitTypedData` for EVM, `svm.orderMessage`
 *      + nonce/deadline for Solana).
 *   2. The caller signs that payload with the funder wallet (EIP-712 on EVM,
 *      the UTF-8 order message on Solana) — signing happens outside this
 *      wrapper because it needs the user's private key.
 *   3. `submitOrder()` submits the signed payload for managed execution.
 * `listOrders()`, `getOrder()`, and `cancelOrder()` cover post-trade lifecycle.
 *
 * Required env vars:
 *   - DEFINITIVE_FLASH_API_KEY  (sent as the `x-definitive-api-key` header)
 * Optional env vars:
 *   - DEFINITIVE_FLASH_INTEGRATOR_FEE_BPS  (default integrator fee, in bps,
 *     applied to quotes/orders that don't set `flashIntegratorFeeBps`)
 *   - DEFINITIVE_FLASH_BASE_URL  (override the API base URL)
 *
 * Usage:
 *   import { definitiveFlash } from "@/lib/services/definitive-flash";
 *   const quote = await definitiveFlash.getQuote({
 *     targetChain: "base", contraChain: "base",
 *     targetAsset: "0x...", contraAsset: "0x...",
 *     side: "buy", qty: "100", orderType: "market",
 *     funderAddress: "0xfunder",
 *   });
 *   // sign quote.evm.orderTypedData with the funder wallet, then:
 *   const order = await definitiveFlash.submitOrder({
 *     ...quote requestFields, funderAddress: "0xfunder",
 *     quoteId: quote.quoteId, userSignature: sig,
 *     evmOrderTypedData: quote.evm?.orderTypedData,
 *   });
 */

import {
  ServiceError,
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "definitive-flash";
const DEFAULT_BASE_URL = "https://flash.definitive.fi/v1";

// ── Types (from the Flash OpenAPI v1 spec) ─────────────────────────────

export type FlashChain =
  | "arbitrum"
  | "avalanche"
  | "base"
  | "bsc"
  | "ethereum"
  | "optimism"
  | "polygon"
  | "solana"
  | "hyperevm"
  | "plasma"
  | "monad"
  | "robinhood";

export type FlashOrderType =
  | "market"
  | "limit"
  | "twap"
  | "stop"
  | "stop-loss"
  | "take-profit"
  | "bracket";

export type FlashOrderSide = "buy" | "sell";

export type FlashOrderStatus =
  | "ORDER_STATUS_UNSPECIFIED"
  | "ORDER_STATUS_PENDING"
  | "ORDER_STATUS_ACCEPTED"
  | "ORDER_STATUS_PARTIALLY_FILLED"
  | "ORDER_STATUS_FILLED"
  | "ORDER_STATUS_CANCELLED"
  | "ORDER_STATUS_REJECTED"
  | "ORDER_STATUS_TERMINATED";

export interface FlashPriceTrigger {
  /** USD-price trigger on the traded asset. */
  notionalPrice: string;
  triggerType: "upper" | "lower";
}

export interface FlashQuoteRequest {
  targetChain: FlashChain;
  contraChain: FlashChain;
  /** Token contract address (or mint on Solana) being acquired. */
  targetAsset: string;
  /** Token contract address (or mint on Solana) being spent. */
  contraAsset: string;
  side: FlashOrderSide;
  /** Quantity as a decimal string. */
  qty: string;
  orderType: FlashOrderType;
  funderAddress?: string;
  quickTrade?: boolean;
  /** Default "0.05". */
  maxSlippage?: string;
  /** Default "0.05". */
  maxPriceImpact?: string;
  /** Required for limit orders. */
  limitNotionalPrice?: string;
  evmUsePermit2?: boolean;
  svmUseNativeSOL?: boolean;
  flashIntegratorFeeBps?: string;
  expireTime?: string;
  startTime?: string;
  /** TWAP window, minimum 300 seconds. */
  durationSeconds?: number;
  /** TWAP bucket count, 2..2560. */
  twapBucketCount?: number;
  /** Up to 2 price triggers (e.g. stop-loss + take-profit for bracket orders). */
  triggers?: FlashPriceTrigger[];
}

export interface FlashQuoteLeg {
  asset: string;
  amount: string;
  notional: string;
}

export interface FlashQuoteFees {
  /** Total fee in USD notional: Definitive's fee + integrator fee + gas. */
  estimatedFeeNotional: string;
}

export interface FlashQuoteEvmActions {
  approveTx?: { to: string; data: string } | null;
  /** EIP-712 typed data for the Permit2 approval. */
  permitTypedData?: string | null;
  /** EIP-712 typed data for the Flash order (sign this with the funder wallet). */
  orderTypedData?: string | null;
}

export interface FlashQuoteSvmActions {
  ataSetupIxs?: unknown[] | null;
  delegateIx?: unknown | null;
  /** Base64-encoded Solana VersionedTransaction. */
  sponsoredDelegateTx?: string | null;
  /** UTF-8 string the user must sign. */
  orderMessage?: string | null;
  nonce?: string | null;
  deadline?: string | null;
}

export interface FlashQuoteResponse {
  quoteId: string;
  orderType: FlashOrderType;
  side: FlashOrderSide;
  targetAsset: string;
  contraAsset: string;
  from: FlashQuoteLeg;
  to: FlashQuoteLeg;
  fees: FlashQuoteFees;
  wrap?: Record<string, unknown> | null;
  evm?: FlashQuoteEvmActions | null;
  svm?: FlashQuoteSvmActions | null;
  [key: string]: unknown;
}

export interface FlashSubmitOrderRequest {
  targetChain: FlashChain;
  contraChain: FlashChain;
  targetAsset: string;
  contraAsset: string;
  side: FlashOrderSide;
  qty: string;
  orderType: FlashOrderType;
  funderAddress: string;
  /** Hex (EVM) or base58 (Solana) signature over the quote's signable payload. */
  userSignature: string;
  quoteId?: string;
  flashIntegratorFeeBps?: string;
  /** ERC-8021 attribution code, `^[a-zA-Z0-9_.-]{1,32}$`. */
  erc8021AttributionCode?: string;
  evmOrderTypedData?: string;
  evmPermitTypedData?: string;
  evmPermitSignature?: string;
  svmNonce?: string;
  svmDeadline?: string;
  svmSponsoredDelegateTx?: string;
  maxSlippage?: string;
  maxPriceImpact?: string;
  limitNotionalPrice?: string;
  quickTrade?: boolean;
  twapBucketCount?: number;
  startTime?: string;
  triggers?: FlashPriceTrigger[];
}

export interface FlashSubmitOrderResponse {
  orderId: string;
  [key: string]: unknown;
}

export interface FlashOrder {
  orderId: string;
  orderType: FlashOrderType;
  side: FlashOrderSide;
  status: FlashOrderStatus;
  funderAddress: string;
  qty: string;
  closeReason?: string | null;
  limitNotionalPrice?: string | null;
  trigger?: FlashPriceTrigger | null;
  brackets?: FlashPriceTrigger[] | null;
  maxPriceImpact?: string | null;
  twapBucketCount?: number | null;
  placedAt?: string;
  acceptedAt?: string | null;
  closedAt?: string | null;
  [key: string]: unknown;
}

export interface FlashFill {
  status: string;
  notional: string;
  orderId: string;
  rootOrderId?: string;
  parentOrderId?: string;
  transactionId?: string;
  venues?: string[];
  fillPrice?: string;
  filledAt?: string;
  feeNotional?: string;
  integratorFeeNotional?: string;
  contraAmount?: string;
  targetAmount?: string;
  [key: string]: unknown;
}

export interface FlashListOrdersResponse {
  orders: FlashOrder[];
}

export interface FlashGetOrderResponse {
  order: FlashOrder;
  fills: FlashFill[];
}

export interface FlashCancelOrderRequest {
  /** UTF-8 plaintext message the funder signs to authorize the cancel. */
  cancelMessage: string;
  /** Hex (EVM) or base58 (Solana) signature over `cancelMessage`. */
  userSignature: string;
}

export interface FlashCancelOrderResponse {
  ok: boolean;
}

export interface FlashListOrdersOptions {
  statuses?: Array<FlashOrderStatus | string>;
  /** 1..200, default 50. */
  pageSize?: number;
}

export interface FlashServiceOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Default integrator fee in bps applied when a request omits it. */
  integratorFeeBps?: string;
}

/** A quote request without `orderType` — used by the per-order-type helpers. */
type FlashQuoteRequestNoType = Omit<FlashQuoteRequest, "orderType">;

// ── Wrapper ────────────────────────────────────────────────────────────

export class DefinitiveFlashService {
  private readonly apiKeyOverride?: string;
  private readonly baseUrl: string;
  private readonly integratorFeeBpsOverride?: string;

  constructor(opts: FlashServiceOptions = {}) {
    this.apiKeyOverride = opts.apiKey;
    this.baseUrl = (
      opts.baseUrl ??
      process.env.DEFINITIVE_FLASH_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.integratorFeeBpsOverride = opts.integratorFeeBps;
  }

  private resolveApiKey(): string {
    const key = this.apiKeyOverride ?? process.env.DEFINITIVE_FLASH_API_KEY;
    if (!key) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "Missing DEFINITIVE_FLASH_API_KEY (or apiKey option). Provision a key at flash.definitive.fi.",
        ),
      );
    }
    return key;
  }

  private defaultIntegratorFeeBps(): string | undefined {
    return (
      this.integratorFeeBpsOverride ??
      process.env.DEFINITIVE_FLASH_INTEGRATOR_FEE_BPS ??
      undefined
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      "x-definitive-api-key": this.resolveApiKey(),
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url.toString(), init);
    if (!res.ok) {
      const payload = await res.text().catch(() => "");
      this.throwHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  private throwHttpError(status: number, payload: string): never {
    const detail = extractMessage(payload);
    if (status === 401 || status === 403) {
      throw new ServiceAuthError(PROVIDER, new Error(detail));
    }
    if (status === 404) {
      throw new ServiceNotFoundError(PROVIDER, undefined, new Error(detail));
    }
    if (status === 429) {
      throw new ServiceRateLimitError(PROVIDER, undefined, new Error(detail));
    }
    throw new ServiceError(
      `[${PROVIDER}] HTTP ${status}: ${detail}`,
      PROVIDER,
      new Error(detail),
    );
  }

  private withFee<T extends { flashIntegratorFeeBps?: string }>(req: T): T {
    if (req.flashIntegratorFeeBps !== undefined) return req;
    const fee = this.defaultIntegratorFeeBps();
    return fee ? { ...req, flashIntegratorFeeBps: fee } : req;
  }

  // ── Quotes ───────────────────────────────────────────────────────────

  /** Request a quote (best route + signable payload) for a Flash swap. */
  async getQuote(req: FlashQuoteRequest): Promise<FlashQuoteResponse> {
    return this.request<FlashQuoteResponse>("POST", "/quote", {
      body: this.withFee(req),
    });
  }

  /** Quote a market (immediate) order. */
  async quoteMarket(req: FlashQuoteRequestNoType): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "market" });
  }

  /** Quote a limit order (`limitNotionalPrice` required). */
  async quoteLimit(req: FlashQuoteRequestNoType): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "limit" });
  }

  /** Quote a TWAP order (set `durationSeconds` and/or `twapBucketCount`). */
  async quoteTwap(req: FlashQuoteRequestNoType): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "twap" });
  }

  /** Quote a stop order (`triggers` define the stop price). */
  async quoteStop(req: FlashQuoteRequestNoType): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "stop" });
  }

  /** Quote a stop-loss order. */
  async quoteStopLoss(
    req: FlashQuoteRequestNoType,
  ): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "stop-loss" });
  }

  /** Quote a take-profit order. */
  async quoteTakeProfit(
    req: FlashQuoteRequestNoType,
  ): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "take-profit" });
  }

  /** Quote a bracket order (stop-loss + take-profit via two `triggers`). */
  async quoteBracket(
    req: FlashQuoteRequestNoType,
  ): Promise<FlashQuoteResponse> {
    return this.getQuote({ ...req, orderType: "bracket" });
  }

  // ── Orders ───────────────────────────────────────────────────────────

  /** Submit a signed order for MEV-protected managed execution. */
  async submitOrder(
    req: FlashSubmitOrderRequest,
  ): Promise<FlashSubmitOrderResponse> {
    return this.request<FlashSubmitOrderResponse>("POST", "/order", {
      body: this.withFee(req),
    });
  }

  /** List a funder's orders (most recent first). */
  async listOrders(
    funderAddress: string,
    options: FlashListOrdersOptions = {},
  ): Promise<FlashListOrdersResponse> {
    return this.request<FlashListOrdersResponse>("GET", "/orders", {
      query: {
        funderAddress,
        statuses: options.statuses?.length
          ? options.statuses.join(",")
          : undefined,
        pageSize:
          options.pageSize !== undefined ? String(options.pageSize) : undefined,
      },
    });
  }

  /** Fetch a single order plus its execution fills. */
  async getOrder(
    orderId: string,
    funderAddress: string,
  ): Promise<FlashGetOrderResponse> {
    return this.request<FlashGetOrderResponse>(
      "GET",
      `/orders/${encodeURIComponent(orderId)}`,
      { query: { funderAddress } },
    );
  }

  /** Cancel a previously submitted order (requires a signed cancel message). */
  async cancelOrder(
    orderId: string,
    req: FlashCancelOrderRequest,
  ): Promise<FlashCancelOrderResponse> {
    return this.request<FlashCancelOrderResponse>(
      "POST",
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      { body: req },
    );
  }
}

function extractMessage(payload: string): string {
  if (!payload) return "request failed";
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const msg = parsed.message ?? parsed.error ?? parsed.detail;
    if (typeof msg === "string" && msg) return msg;
  } catch {
    // not JSON — fall through to the raw text
  }
  return payload.slice(0, 300);
}

export const definitiveFlash = new DefinitiveFlashService();
export default definitiveFlash;
