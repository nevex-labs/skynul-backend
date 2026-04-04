/**
 * SmartWalletService — Effect.js service for managing ERC-4337 Smart Accounts.
 *
 * This service orchestrates Smart Account creation, balance queries,
 * and session key management.
 */

import { Context, Effect } from 'effect';
import type { SessionKey } from '../../core/chain/domain';
import { DatabaseError } from '../../shared/errors';

export interface SmartWalletServiceApi {
  /**
   * Get or create a Smart Account for a user on a specific chain.
   * Returns the Smart Account address.
   */
  readonly getOrCreateSmartAccount: (userId: number, chainId: number) => Effect.Effect<string, DatabaseError, never>;

  /**
   * Get the Smart Account address for a user on a specific chain.
   * Returns null if not yet created.
   */
  readonly getSmartAccount: (userId: number, chainId: number) => Effect.Effect<string | null, DatabaseError, never>;

  /**
   * Check if a Smart Account is deployed on-chain.
   */
  readonly isAccountDeployed: (address: string, chainId: number) => Effect.Effect<boolean, DatabaseError, never>;

  /**
   * Get the balance of an ERC-20 token in a Smart Account.
   */
  readonly getTokenBalance: (
    smartAccountAddress: string,
    tokenAddress: string,
    chainId: number
  ) => Effect.Effect<bigint, DatabaseError, never>;

  /**
   * Create a Session Key for the trading agent.
   * The user must sign this with their EOA.
   */
  readonly createSessionKey: (
    userId: number,
    chainId: number,
    params: {
      maxPerTrade: bigint;
      dailyLimit: bigint;
      expiresAt: number;
      allowedTokens: string[];
    }
  ) => Effect.Effect<SessionKey, DatabaseError, never>;

  /**
   * Revoke the current Session Key for a user.
   */
  readonly revokeSessionKey: (userId: number, chainId: number) => Effect.Effect<void, DatabaseError, never>;

  /**
   * Get the current Session Key for a user.
   */
  readonly getSessionKey: (userId: number, chainId: number) => Effect.Effect<SessionKey | null, DatabaseError, never>;
}

export class SmartWalletService extends Context.Tag('SmartWalletService')<
  SmartWalletService,
  SmartWalletServiceApi
>() {}
