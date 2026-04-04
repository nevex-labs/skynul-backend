import { Context, Effect } from 'effect';
import type { Wallet } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';

export type ChainType = 'evm' | 'solana' | 'bitcoin';

export interface WalletServiceApi {
  /**
   * Find or create a user by wallet address
   */
  readonly findOrCreateUser: (
    address: string,
    chain: ChainType
  ) => Effect.Effect<{ userId: number; wallet: Wallet }, DatabaseError>;

  /**
   * Get wallet info by address
   */
  readonly getWallet: (address: string, chain: ChainType) => Effect.Effect<Wallet | null, DatabaseError>;

  /**
   * Get all wallets for a user
   */
  readonly getUserWallets: (userId: number) => Effect.Effect<Wallet[], DatabaseError>;

  /**
   * Update last signed at timestamp
   */
  readonly updateLastSignedAt: (address: string, chain: ChainType) => Effect.Effect<void, DatabaseError>;

  /**
   * Remove a wallet from a user
   */
  readonly removeWallet: (address: string, chain: ChainType) => Effect.Effect<void, DatabaseError>;
}

export class WalletService extends Context.Tag('WalletService')<WalletService, WalletServiceApi>() {}
