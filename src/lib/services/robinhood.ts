/**
 * Robinhood Stock Tokens service wrapper (thin shim).
 *
 * Robinhood Stock Tokens are tokenised US equities/ETFs issued as ERC-20 tokens
 * (18 decimals) on Robinhood Chain (chainId 4663). Each token also implements
 * ERC-8056 — a corporate-action multiplier (`uiMultiplier`) that adjusts for
 * splits/dividends without rebasing — and has a Chainlink price feed.
 *
 * This wrapper exposes TWO surfaces:
 *
 *   1. OFF-CHAIN REST  — the public, unauthenticated `rhj` API
 *      (https://api.robinhood.com/rhj): asset registry, live bid/ask quotes,
 *      and processed corporate actions. No API key required.
 *
 *   2. ON-CHAIN reads  — direct `view` calls against the token + Chainlink feed
 *      contracts on Robinhood Chain via viem (balances, multiplier, oracle
 *      status, feed price). Read-only: minting/burning is restricted to
 *      Authorized Participants and is intentionally NOT exposed here.
 *
 * IMPORTANT distinction between the two price sources:
 *   - REST `getPrice(symbol)` returns the RAW underlying-equity USD bid/ask,
 *     passed through as-is — it is NOT multiplier-adjusted.
 *   - On-chain `readPriceFeed(feed)` returns the Chainlink answer for one token,
 *     which is the underlying share price TIMES the multiplier (total return).
 *
 * Optional env vars (both have sane public defaults):
 *   - ROBINHOOD_API_BASE_URL   (default: https://api.robinhood.com/rhj)
 *   - ROBINHOOD_CHAIN_RPC_URL  (default: https://rpc.mainnet.chain.robinhood.com)
 *
 * Compliance note: Stock Tokens may not be offered or sold to U.S. persons or
 * within the United States (additional restrictions apply in CA/UK/CH). This
 * wrapper only reads public data and on-chain state; it does not gate access.
 *
 * Usage:
 *   import { robinhood } from "@/lib/services/robinhood";
 *   const assets = await robinhood.getAssets();
 *   const quote  = await robinhood.getPrice("APLD");
 *   const addr   = await robinhood.resolveContractAddress("APLD");
 *   const shares = await robinhood.getTokenBalanceUI(addr, "0xabc...");
 */

import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
} from "viem";
import {
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "robinhood";
const DEFAULT_API_BASE_URL = "https://api.robinhood.com/rhj";
const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_CHAIN_ID = 4663;

/** viem chain definition for Robinhood Chain (chainId 4663). */
export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_RPC_URL] } },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

// ── Minimal ABIs (view-only) ────────────────────────────────────────────────

/** ERC-20 + ERC-8056 (stock token) read surface. */
const STOCK_TOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOfUI",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "oraclePaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Chainlink AggregatorV3Interface (price feed) read surface. */
const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

// ── REST response types (shapes verified against the live rhj API) ───────────

export interface RobinhoodDeployment {
  contractAddress: string;
  chainId: number;
  networkName: string;
}

export interface RobinhoodTradingStatus {
  whole: string;
  fractional: string;
}

export interface RobinhoodTradingCapabilities {
  market: RobinhoodTradingStatus;
  extended: RobinhoodTradingStatus;
  overnight: RobinhoodTradingStatus;
}

export interface RobinhoodAsset {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  deployments: RobinhoodDeployment[];
  currentMultiplier: string;
  pendingMultiplier: string;
  status: string;
  logoUrl: string;
  tradingCapabilities: RobinhoodTradingCapabilities;
  tokenDecimals: number;
  isin: string;
}

export interface RobinhoodQuote {
  tokenSymbol: string;
  deployments: RobinhoodDeployment[];
  bid: string;
  ask: string;
  currency: string;
  dailyTradingVolume: string;
  isTradingHalt: boolean;
  generatedAt: string;
  dailyHigh: string;
  dailyLow: string;
  mintBurnTokenVolume: string;
  mintBurnUsdVolume: string;
}

export interface RobinhoodProcessDate {
  year: number;
  month: number;
  day: number;
}

export interface RobinhoodCorporateAction {
  id: string;
  type: string;
  status: string;
  processDate: RobinhoodProcessDate;
  tokenSymbol: string;
  deployments: RobinhoodDeployment[];
  details: Record<string, unknown>;
}

export interface ChainlinkRoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
  /** Feed decimals (Robinhood/Chainlink USD feeds are typically 8). */
  decimals: number;
}

type PublicClientType = ReturnType<typeof createPublicClient>;

export interface RobinhoodOptions {
  apiBaseUrl?: string;
  rpcUrl?: string;
}

export class RobinhoodService {
  private readonly apiBaseUrl: string;
  private readonly rpcUrl: string;
  private _client: PublicClientType | null = null;

  constructor(opts: RobinhoodOptions = {}) {
    this.apiBaseUrl = (
      opts.apiBaseUrl ||
      process.env.ROBINHOOD_API_BASE_URL ||
      DEFAULT_API_BASE_URL
    ).replace(/\/$/, "");
    this.rpcUrl =
      opts.rpcUrl || process.env.ROBINHOOD_CHAIN_RPC_URL || DEFAULT_RPC_URL;
  }

  // ── OFF-CHAIN REST (rhj API) ───────────────────────────────────────────────

  /** All Stock Token assets: metadata, deployments, multipliers, trading flags. */
  async getAssets(): Promise<RobinhoodAsset[]> {
    const data = await this.request<{ assets: RobinhoodAsset[] }>("/assets");
    return data.assets ?? [];
  }

  /** A single asset by ticker symbol (case-insensitive). */
  async getAsset(symbol: string): Promise<RobinhoodAsset> {
    const target = symbol.trim().toUpperCase();
    const assets = await this.getAssets();
    const match = assets.find(
      (a) => a.tokenSymbol.toUpperCase() === target,
    );
    if (!match) throw new ServiceNotFoundError(PROVIDER, `asset:${symbol}`);
    return match;
  }

  /** Live token-denominated USD bid/ask for one symbol (RAW, not multiplier-adjusted). */
  async getPrice(symbol: string): Promise<RobinhoodQuote> {
    const data = await this.request<{ quotes: RobinhoodQuote[] }>(
      `/prices/${encodeURIComponent(symbol.trim().toUpperCase())}`,
    );
    const quote = data.quotes?.[0];
    if (!quote) throw new ServiceNotFoundError(PROVIDER, `price:${symbol}`);
    return quote;
  }

  /** Processed corporate actions, most-recent processDate first. */
  async getCorporateActions(): Promise<RobinhoodCorporateAction[]> {
    const data = await this.request<{ corpActions: RobinhoodCorporateAction[] }>(
      "/corporate-actions",
    );
    return data.corpActions ?? [];
  }

  /**
   * Resolve a ticker to its canonical on-chain contract address for a chain
   * (defaults to Robinhood Chain). The asset registry is dynamic, so addresses
   * must be resolved at runtime rather than hard-coded.
   */
  async resolveContractAddress(
    symbol: string,
    chainId: number = ROBINHOOD_CHAIN_ID,
  ): Promise<Address> {
    const asset = await this.getAsset(symbol);
    const deployment = asset.deployments.find((d) => d.chainId === chainId);
    if (!deployment) {
      throw new ServiceNotFoundError(
        PROVIDER,
        `deployment:${symbol}@${chainId}`,
      );
    }
    return getAddress(deployment.contractAddress);
  }

  private async request<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      throw new ServiceError(
        `[${PROVIDER}] network error calling ${path}`,
        PROVIDER,
        err,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new ServiceNotFoundError(PROVIDER, path, body);
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || undefined;
        throw new ServiceRateLimitError(PROVIDER, retryAfter, body);
      }
      throw new ServiceError(
        `[${PROVIDER}] HTTP ${res.status} on ${path}`,
        PROVIDER,
        body,
      );
    }
    return (await res.json()) as T;
  }

  // ── ON-CHAIN reads (Robinhood Chain via viem) ───────────────────────────────

  private get client(): PublicClientType {
    if (!this._client) {
      this._client = createPublicClient({
        chain: robinhoodChain,
        transport: http(this.rpcUrl),
      });
    }
    return this._client;
  }

  /** Raw ERC-20 token balance (18 decimals, NOT multiplier-adjusted). */
  async getTokenBalance(token: Address, holder: Address): Promise<bigint> {
    return this.wrap(`token:${token}.balanceOf`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "balanceOf",
        args: [getAddress(holder)],
      }),
    );
  }

  /** Underlying-share balance (multiplier-adjusted) via ERC-8056 `balanceOfUI`. */
  async getTokenBalanceUI(token: Address, holder: Address): Promise<bigint> {
    return this.wrap(`token:${token}.balanceOfUI`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "balanceOfUI",
        args: [getAddress(holder)],
      }),
    );
  }

  /** Current corporate-action multiplier (scaled by 1e18). */
  async getUiMultiplier(token: Address): Promise<bigint> {
    return this.wrap(`token:${token}.uiMultiplier`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "uiMultiplier",
      }),
    );
  }

  /** Token decimals (Stock Tokens use 18). */
  async getTokenDecimals(token: Address): Promise<number> {
    return this.wrap(`token:${token}.decimals`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "decimals",
      }),
    );
  }

  /** Token ERC-20 symbol. */
  async getTokenSymbol(token: Address): Promise<string> {
    return this.wrap(`token:${token}.symbol`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "symbol",
      }),
    );
  }

  /** Whether the token's price oracle is currently paused (e.g. during a corporate action). */
  async isOraclePaused(token: Address): Promise<boolean> {
    return this.wrap(`token:${token}.oraclePaused`, () =>
      this.client.readContract({
        address: getAddress(token),
        abi: STOCK_TOKEN_ABI,
        functionName: "oraclePaused",
      }),
    );
  }

  /**
   * Read a Chainlink price feed (AggregatorV3Interface). The `feed` address must
   * come from the Chainlink Robinhood feeds registry / Oracles docs — it is not
   * returned by the rhj API. The returned `answer` is the token price (share
   * price × multiplier); scale by `10 ** decimals`.
   */
  async readPriceFeed(feed: Address): Promise<ChainlinkRoundData> {
    const feedAddr = getAddress(feed);
    return this.wrap(`feed:${feedAddr}`, async () => {
      const [round, decimals] = await Promise.all([
        this.client.readContract({
          address: feedAddr,
          abi: AGGREGATOR_V3_ABI,
          functionName: "latestRoundData",
        }),
        this.client.readContract({
          address: feedAddr,
          abi: AGGREGATOR_V3_ABI,
          functionName: "decimals",
        }),
      ]);
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = round;
      return {
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        decimals,
      };
    });
  }

  private async wrap<T>(resource: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.normalizeOnchainError(err, resource);
    }
  }

  private normalizeOnchainError(err: unknown, resource: string): ServiceError {
    if (err instanceof ServiceError) return err;
    const message =
      err instanceof Error ? err.message : "on-chain read failed";
    return new ServiceError(
      `[${PROVIDER}] ${message} (${resource})`,
      PROVIDER,
      err,
    );
  }
}

export const robinhood = new RobinhoodService();
export default robinhood;
