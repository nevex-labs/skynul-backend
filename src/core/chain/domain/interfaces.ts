/**
 * Domain interfaces for the multichain AA trading layer.
 *
 * These interfaces define the contracts that infrastructure adapters must implement.
 * The system is provider-agnostic — swap Pimlico for Alchemy by implementing these.
 */

import type {
  EncodedCall,
  EvmCall,
  GasEstimate,
  PaymasterData,
  Quote,
  QuoteParams,
  SessionKey,
  UserOpResult,
  UserOperation,
} from './types';

/** Abstract chain provider — each chain implements this */
export interface ChainProvider {
  readonly chainId: number;
  getBalance(address: string, tokenAddress?: string): Promise<string>;
  getNonce(address: string): Promise<number>;
  estimateGas(call: EvmCall): Promise<bigint>;
  sendUserOperation(op: UserOperation): Promise<UserOpResult>;
  getUserOperationReceipt(opHash: string): Promise<UserOpResult>;
}

/** Abstract paymaster — pays gas in USDC */
export interface Paymaster {
  readonly chainId: number;
  getPaymasterData(userOp: UserOperation): Promise<PaymasterData>;
  isSupported(tokenAddress: string): Promise<boolean>;
}

/** Abstract DEX router — executes swaps */
export interface SwapRouter {
  readonly chainId: number;
  getQuote(params: QuoteParams): Promise<Quote>;
  encodeSwap(params: QuoteParams): Promise<EncodedCall>;
}

/** Abstract bundler — submits UserOps to the network */
export interface Bundler {
  readonly chainId: number;
  sendUserOperation(op: UserOperation): Promise<string>;
  getUserOperationReceipt(hash: string): Promise<UserOpResult>;
  estimateUserOperationGas(op: UserOperation): Promise<GasEstimate>;
}

/** Smart wallet — ERC-4337 account */
export interface SmartWallet {
  readonly address: string;
  readonly owner: string;
  readonly chainId: number;
  create(): Promise<string>;
  execute(calls: EvmCall[]): Promise<UserOpResult>;
  getSessionKey(): Promise<SessionKey | null>;
  revokeSessionKey(): Promise<void>;
}
