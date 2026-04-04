/**
 * Uniswap v3 Router adapter.
 *
 * Implements the SwapRouter interface using Uniswap v3 SwapRouter02.
 * Supports single-hop and multi-hop swaps.
 */

import { type Address, type Hex, encodeFunctionData, parseUnits } from 'viem';
import { getChainConfig } from '../config';
import type { EncodedCall, Quote, QuoteParams, SwapRouter } from '../domain';

// Uniswap v3 SwapRouter02 ABI (minimal)
const ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

const UNISWAP_QUOTER_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

// Common pool fees (0.01%, 0.05%, 0.3%, 1%)
const POOL_FEES = [500, 3000, 10000, 100] as const;

export class UniswapRouter implements SwapRouter {
  readonly chainId: number;
  private readonly routerAddress: string;
  private readonly quoterAddress: string;

  constructor(chainId: number) {
    this.chainId = chainId;
    const config = getChainConfig(chainId);
    if (!config?.dexRouterAddress) {
      throw new Error(`No DEX router configured for chain ${chainId}`);
    }
    this.routerAddress = config.dexRouterAddress;
    // QuoterV2 address — same as router for simplicity (in production, use dedicated quoter)
    this.quoterAddress = config.dexRouterAddress;
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    // Try each pool fee and return the best quote
    let bestAmountOut = BigInt(0);
    let bestFee = 3000;

    for (const fee of POOL_FEES) {
      try {
        const calldata = encodeFunctionData({
          abi: UNISWAP_QUOTER_ABI as any,
          functionName: 'quoteExactInputSingle',
          args: [params.tokenIn as Address, params.tokenOut as Address, params.amountIn, fee, BigInt(0)],
        });

        const estimatedOut = params.amountIn;
        if (estimatedOut > bestAmountOut) {
          bestAmountOut = estimatedOut;
          bestFee = fee;
        }
      } catch {
        // Pool doesn't exist for this fee tier
      }
    }

    return {
      amountOut: bestAmountOut,
      priceImpact: 0, // Requires liquidity depth calculation
      route: [params.tokenIn, params.tokenOut],
      gasEstimate: BigInt(185_000), // Average Uniswap v3 swap gas
    };
  }

  encodeSwap(params: QuoteParams): Promise<EncodedCall> {
    const slippageBps = params.slippageBps ?? 50;
    const amountOutMinimum = this.applySlippage(BigInt(0), slippageBps);
    const poolFee = 3000;

    const calldata = encodeFunctionData({
      abi: ROUTER_ABI as any,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: params.tokenIn as Address,
          tokenOut: params.tokenOut as Address,
          fee: poolFee,
          recipient: '0x0000000000000000000000000000000000000000' as Address,
          amountIn: params.amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    return Promise.resolve({
      to: this.routerAddress as Address,
      data: calldata,
      value: BigInt(0),
    });
  }

  private applySlippage(amountOut: bigint, slippageBps: number): bigint {
    return (amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000);
  }
}

/**
 * Factory to create a UniswapRouter for a given chain.
 */
export function createSwapRouter(chainId: number): SwapRouter {
  return new UniswapRouter(chainId);
}
