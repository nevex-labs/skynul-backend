/**
 * Pimlico Bundler adapter.
 *
 * Implements the Bundler interface using Pimlico's JSON-RPC API.
 * Uses viem for type-safe RPC calls.
 *
 * Free tier: 100k UserOps/month
 * Docs: https://docs.pimlico.io/bundler
 */

import { http, type Address, type Chain, type Hex, createPublicClient } from 'viem';
import { arbitrum, base, baseSepolia } from 'viem/chains';
import { getChainConfig } from '../config';
import type { Bundler, GasEstimate, UserOpResult, UserOperation } from '../domain';

const VIEM_CHAINS: Record<number, Chain> = {
  8453: base,
  42161: arbitrum as unknown as Chain,
  84532: baseSepolia as unknown as Chain,
};

/**
 * Pimlico bundler client.
 * Requires PIMLICO_API_KEY environment variable.
 */
export class PimlicoBundler implements Bundler {
  readonly chainId: number;
  private readonly bundlerUrl: string;
  private readonly client: ReturnType<typeof createPublicClient>;

  constructor(chainId: number) {
    this.chainId = chainId;
    const config = getChainConfig(chainId);
    if (!config?.bundlerUrl) {
      throw new Error(`No bundler URL configured for chain ${chainId}`);
    }

    const apiKey = process.env.PIMLICO_API_KEY;
    if (!apiKey) {
      throw new Error('PIMLICO_API_KEY environment variable is required');
    }

    this.bundlerUrl = config.bundlerUrl + apiKey;

    const viemChain = VIEM_CHAINS[chainId];
    if (!viemChain) {
      throw new Error(`No viem chain mapping for chainId ${chainId}`);
    }

    this.client = createPublicClient({
      chain: viemChain,
      transport: http(this.bundlerUrl),
    });
  }

  async sendUserOperation(op: UserOperation): Promise<string> {
    const userOp = this.toPimlicoUserOp(op);
    const entryPoint = getChainConfig(this.chainId)?.entryPointAddress ?? '';

    const hash = await this.client.request({
      method: 'eth_sendUserOperation',
      params: [userOp, entryPoint as Address],
    });

    return hash as string;
  }

  async getUserOperationReceipt(hash: string): Promise<UserOpResult> {
    const receipt = (await this.client.request({
      method: 'eth_getUserOperationReceipt',
      params: [hash as Hex],
    })) as {
      userOpHash: Hex;
      transactionHash: Hex;
      success: boolean;
      actualGasUsed: Hex;
      actualGasCost: Hex;
      logs: Array<{ address: Hex; topics: Hex[]; data: Hex }>;
    };

    return {
      userOpHash: receipt.userOpHash,
      txHash: receipt.transactionHash,
      status: receipt.success ? 'success' : 'failed',
      gasUsed: BigInt(receipt.actualGasUsed),
      gasPrice: BigInt(receipt.actualGasCost) / BigInt(receipt.actualGasUsed),
      logs: receipt.logs.map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    };
  }

  async estimateUserOperationGas(op: UserOperation): Promise<GasEstimate> {
    const userOp = this.toPimlicoUserOp(op);
    const entryPoint = getChainConfig(this.chainId)?.entryPointAddress ?? '';

    const estimate = (await this.client.request({
      method: 'eth_estimateUserOperationGas',
      params: [userOp, entryPoint as Address],
    })) as {
      callGasLimit: Hex;
      verificationGasLimit: Hex;
      preVerificationGas: Hex;
    };

    return {
      callGasLimit: BigInt(estimate.callGasLimit),
      verificationGasLimit: BigInt(estimate.verificationGasLimit),
      preVerificationGas: BigInt(estimate.preVerificationGas),
    };
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
 * Factory to create a PimlicoBundler for a given chain.
 */
export function createBundler(chainId: number): Bundler {
  return new PimlicoBundler(chainId);
}
