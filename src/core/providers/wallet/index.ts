/**
 * Wallet Provider — Multi-chain wallet abstraction
 *
 * Supports:
 * - EVM chains (Base, Ethereum) via viem
 * - Solana (planned)
 * - Bitcoin (planned)
 *
 * Unified interface for signing transactions,
 * checking balances, and managing connections.
 */

import type { Hex } from 'viem';

// ── Types ────────────────────────────────────────────────────────────────────

export type ChainType = 'evm' | 'solana' | 'bitcoin';

export type ChainId =
  | 'base' // Base Mainnet
  | 'base-sepolia' // Base Testnet
  | 'ethereum'
  | 'solana';

export interface WalletConfig {
  type: ChainType;
  chainId: ChainId;
  rpcUrl?: string;
  privateKey?: string; // For server-side wallets
}

export interface WalletConnection {
  address: string;
  chainId: ChainId;
  connected: boolean;
  balance: TokenBalance[];
}

export interface TokenBalance {
  token: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUsd?: number;
}

export interface TransactionRequest {
  to: string;
  value?: string;
  data?: Hex | string;
  token?: string;
}

export interface TransactionReceipt {
  hash: string;
  status: 'success' | 'failed' | 'pending';
  blockNumber?: number;
  gasUsed?: string;
  feeUsd?: number;
}

// ── Wallet Provider Interface ────────────────────────────────────────────────

export interface WalletProvider {
  readonly type: ChainType;
  readonly chainId: ChainId;

  connect(config: WalletConfig): Promise<WalletConnection>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getAddress(): string | null;
  getBalance(token?: string): Promise<TokenBalance>;
  sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt>;
}

// ── EVM Provider (Base, Ethereum) ────────────────────────────────────────────

export class EvmWalletProvider implements WalletProvider {
  readonly type = 'evm';
  chainId: ChainId = 'base';

  private client: any = null;
  private account: any = null;

  async connect(config: WalletConfig): Promise<WalletConnection> {
    const { createWalletClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { base, baseSepolia, mainnet } = await import('viem/chains');

    this.chainId = config.chainId;

    const chains: Record<string, any> = {
      base: base,
      'base-sepolia': baseSepolia,
      ethereum: mainnet,
    };

    const chain = chains[config.chainId];
    if (!chain) throw new Error(`Chain ${config.chainId} not supported`);

    if (!config.privateKey) {
      throw new Error('Private key required for server-side wallet');
    }

    this.account = privateKeyToAccount(config.privateKey as Hex);
    this.client = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    });

    const balance = await this.getBalance();

    return {
      address: this.account.address,
      chainId: config.chainId,
      connected: true,
      balance: [balance],
    };
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.account = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  getAddress(): string | null {
    return this.account?.address ?? null;
  }

  async getBalance(_token?: string): Promise<TokenBalance> {
    if (!this.client) throw new Error('Not connected');

    const balance = await this.client.getBalance({
      address: this.account.address,
    });

    return {
      token: 'ETH',
      symbol: 'ETH',
      decimals: 18,
      balance: balance.toString(),
    };
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt> {
    if (!this.client) throw new Error('Not connected');

    const { parseEther } = await import('viem');

    const hash = await this.client.sendTransaction({
      to: tx.to as Hex,
      value: tx.value ? parseEther(tx.value) : undefined,
      data: tx.data as Hex | undefined,
    });

    return { hash, status: 'pending' };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createWalletProvider(chainId: ChainId): WalletProvider {
  if (chainId.startsWith('base') || chainId === 'ethereum') {
    return new EvmWalletProvider();
  }
  throw new Error(`Chain ${chainId} not implemented yet`);
}

export function isChainSupported(chainId: string): boolean {
  return ['base', 'base-sepolia', 'ethereum'].includes(chainId);
}
