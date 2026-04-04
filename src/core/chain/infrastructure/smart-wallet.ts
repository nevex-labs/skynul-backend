/**
 * Smart Wallet — ERC-4337 Account implementation.
 *
 * Manages a user's Smart Account (SimpleAccount from Infinitism).
 * The agent can execute trades within Session Key limits.
 *
 * NOTE: This is a stub that defines the interface and structure.
 * Full implementation requires deploying a SimpleAccount factory
 * and integrating with permissionless.js or a similar library.
 */

import { http, type Address, type Chain, type Hex, createPublicClient } from 'viem';
import { arbitrum, base, baseSepolia } from 'viem/chains';
import { getChainConfig } from '../config';
import type { EvmCall, SessionKey, SmartWallet, UserOpResult } from '../domain';

const VIEM_CHAINS: Record<number, Chain> = {
  8453: base,
  42161: arbitrum as unknown as Chain,
  84532: baseSepolia as unknown as Chain,
};

/**
 * SmartWallet implementation using ERC-4337 SimpleAccount.
 */
export class ERC4337SmartWallet implements SmartWallet {
  readonly address: string;
  readonly owner: string;
  readonly chainId: number;
  private readonly client: ReturnType<typeof createPublicClient>;

  constructor(params: { address: string; owner: string; chainId: number }) {
    this.address = params.address;
    this.owner = params.owner;
    this.chainId = params.chainId;

    const viemChain = VIEM_CHAINS[params.chainId];
    if (!viemChain) {
      throw new Error(`No viem chain mapping for chainId ${params.chainId}`);
    }

    const config = getChainConfig(params.chainId);
    this.client = createPublicClient({
      chain: viemChain,
      transport: http(config?.rpcUrl ?? ''),
    });
  }

  async create(): Promise<string> {
    // In production: deploy SimpleAccount via EntryPoint
    // This requires the account factory address and init code
    throw new Error(
      'Smart Account creation requires deployment via EntryPoint. ' +
        'Use permissionless.js or deploy SimpleAccount factory first.'
    );
  }

  async execute(_calls: EvmCall[]): Promise<UserOpResult> {
    // In production: build UserOperation, get paymaster data,
    // sign with Session Key, send via Bundler
    throw new Error(
      'UserOperation execution requires a Bundler and Paymaster. ' +
        'Use the SwapService which orchestrates the full flow.'
    );
  }

  async getSessionKey(): Promise<SessionKey | null> {
    // In production: read session key from Smart Account storage
    // or from an off-chain cache (our DB)
    return null;
  }

  async revokeSessionKey(): Promise<void> {
    // In production: call revokeSessionKey on the Smart Account
    throw new Error('Session key revocation requires a UserOperation signed by the owner.');
  }

  /**
   * Get the balance of an ERC-20 token in this Smart Account.
   */
  async getTokenBalance(tokenAddress: string): Promise<string> {
    const erc20Abi = [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
      },
    ] as const;

    const balance = await this.client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.address as Address],
    });

    return (balance as bigint).toString();
  }

  /**
   * Check if this Smart Account has been deployed.
   */
  async isDeployed(): Promise<boolean> {
    const code = await this.client.getBytecode({
      address: this.address as Address,
    });
    return code !== undefined && code !== '0x';
  }
}

/**
 * Factory to create a SmartWallet for a given user.
 */
export function createSmartWallet(params: {
  address: string;
  owner: string;
  chainId: number;
}): SmartWallet {
  return new ERC4337SmartWallet(params);
}
