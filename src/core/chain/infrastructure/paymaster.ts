/**
 * Pimlico Paymaster adapter.
 *
 * Implements the Paymaster interface using Pimlico's ERC-20 paymaster.
 * Allows users to pay gas fees in USDC instead of ETH.
 *
 * Docs: https://docs.pimlico.io/paymaster
 */

import { http, type Address, type Chain, type Hex, createPublicClient } from 'viem';
import { arbitrum, base, baseSepolia } from 'viem/chains';
import { getChainConfig } from '../config';
import type { Paymaster, PaymasterData, UserOperation } from '../domain';

const VIEM_CHAINS: Record<number, Chain> = {
  8453: base,
  42161: arbitrum as unknown as Chain,
  84532: baseSepolia as unknown as Chain,
};

export class PimlicoPaymaster implements Paymaster {
  readonly chainId: number;
  private readonly paymasterUrl: string;
  private readonly client: ReturnType<typeof createPublicClient>;

  constructor(chainId: number) {
    this.chainId = chainId;
    const config = getChainConfig(chainId);
    if (!config?.paymasterUrl) {
      throw new Error(`No paymaster URL configured for chain ${chainId}`);
    }

    const apiKey = process.env.PIMLICO_API_KEY;
    if (!apiKey) {
      throw new Error('PIMLICO_API_KEY environment variable is required');
    }

    this.paymasterUrl = config.paymasterUrl + apiKey;

    const viemChain = VIEM_CHAINS[chainId];
    if (!viemChain) {
      throw new Error(`No viem chain mapping for chainId ${chainId}`);
    }

    this.client = createPublicClient({
      chain: viemChain,
      transport: http(this.paymasterUrl),
    });
  }

  async getPaymasterData(userOp: UserOperation): Promise<PaymasterData> {
    const pimlicoUserOp = this.toPimlicoUserOp(userOp);
    const entryPoint = getChainConfig(this.chainId)?.entryPointAddress ?? '';
    const usdcAddress = getChainConfig(this.chainId)?.usdcAddress ?? '';

    const result = (await this.client.request({
      method: 'pm_sponsorUserOperation',
      params: [pimlicoUserOp, entryPoint as Address, { token: usdcAddress as Address }],
    })) as {
      paymaster: Address;
      paymasterData: Hex;
      paymasterVerificationGasLimit: Hex;
      paymasterPostOpGasLimit: Hex;
    };

    return {
      paymaster: result.paymaster,
      paymasterData: result.paymasterData,
      paymasterVerificationGasLimit: BigInt(result.paymasterVerificationGasLimit),
      paymasterPostOpGasLimit: BigInt(result.paymasterPostOpGasLimit),
    };
  }

  async isSupported(tokenAddress: string): Promise<boolean> {
    const config = getChainConfig(this.chainId);
    return config?.usdcAddress?.toLowerCase() === tokenAddress.toLowerCase();
  }

  private toPimlicoUserOp(op: UserOperation): Record<string, unknown> {
    return {
      sender: op.sender,
      nonce: `0x${op.nonce.toString(16)}`,
      initCode: op.initCode,
      callData: op.callData,
      callGasLimit: `0x${op.callGasLimit.toString(16)}`,
      verificationGasLimit: `0x${op.verificationGasLimit.toString(16)}`,
      preVerificationGas: `0x${op.preVerificationGas.toString(16)}`,
      maxFeePerGas: `0x${op.maxFeePerGas.toString(16)}`,
      maxPriorityFeePerGas: `0x${op.maxPriorityFeePerGas.toString(16)}`,
      paymasterAndData: op.paymasterAndData,
      signature: op.signature,
    };
  }
}

/**
 * Factory to create a PimlicoPaymaster for a given chain.
 */
export function createPaymaster(chainId: number): Paymaster {
  return new PimlicoPaymaster(chainId);
}
