/**
 * Uniswap service wrapper (thin shim).
 *
 * Wraps the official `@uniswap/sdk-core` with convenience utilities for
 * token definitions and price calculations. The Uniswap SDK is a local
 * computation library (no API key needed) — actual swaps require an
 * Ethereum provider/signer.
 *
 * No env vars required (SDK is computation-only).
 *
 * Usage:
 *   import { uniswap } from "@/lib/services/uniswap";
 *   const token = uniswap.createToken(1, "0x...", 18, "USDC", "USD Coin");
 */

import { Token, CurrencyAmount, TradeType, Percent } from "@uniswap/sdk-core";
import {
  ServiceError,
} from "./errors";

const PROVIDER = "uniswap";

export class UniswapService {
  createToken(
    chainId: number,
    address: string,
    decimals: number,
    symbol?: string,
    name?: string,
  ): Token {
    return new Token(chainId, address, decimals, symbol, name);
  }

  parseCurrencyAmount(token: Token, amount: string): CurrencyAmount<Token> {
    return CurrencyAmount.fromRawAmount(token, amount);
  }

  slippageTolerance(bps: number): Percent {
    return new Percent(bps, 10_000);
  }

  get TradeType() {
    return TradeType;
  }
}

export const uniswap = new UniswapService();
export default uniswap;
export { Token, CurrencyAmount, TradeType, Percent };
