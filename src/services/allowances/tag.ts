import { Context, Effect } from 'effect';
import { DatabaseError } from '../../shared/errors';
import type { AllowanceCheck } from './fee-config';

// Domain type with bigint amounts
export interface AllowanceDomain {
  id: number;
  userId: number;
  tokenAddress: string;
  chainId: number;
  approvedAmount: bigint;
  usedAmount: bigint;
  feeCollected: bigint;
  lastSyncAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AllowanceServiceApi {
  /** Check if a user has sufficient allowance for a trade */
  readonly checkAllowance: (
    userId: number,
    tokenAddress: string,
    chainId: number,
    tradeAmount: bigint
  ) => Effect.Effect<AllowanceCheck, DatabaseError, never>;

  /** Record usage of allowance after a successful trade */
  readonly recordUsage: (
    userId: number,
    tokenAddress: string,
    chainId: number,
    tradeAmount: bigint,
    feeAmount: bigint
  ) => Effect.Effect<void, DatabaseError, never>;

  /** Set the approved amount (called when user approves via MetaMask) */
  readonly setApprovedAmount: (
    userId: number,
    tokenAddress: string,
    chainId: number,
    approvedAmount: bigint
  ) => Effect.Effect<void, DatabaseError, never>;

  /** Get current allowance record */
  readonly getAllowance: (
    userId: number,
    tokenAddress: string,
    chainId: number
  ) => Effect.Effect<AllowanceDomain | null, DatabaseError, never>;

  /** Get total fees collected for a user */
  readonly getTotalFeesCollected: (userId: number) => Effect.Effect<bigint, DatabaseError, never>;

  /** Get remaining allowance (approved - used - fees) */
  readonly getRemainingAllowance: (
    userId: number,
    tokenAddress: string,
    chainId: number
  ) => Effect.Effect<bigint, DatabaseError, never>;
}

export class AllowanceService extends Context.Tag('AllowanceService')<AllowanceService, AllowanceServiceApi>() {}
