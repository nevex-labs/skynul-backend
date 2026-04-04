import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { allowances } from '../../infrastructure/db/schema';
import type { Allowance, NewAllowance } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { type AllowanceCheck, calculateFee } from './fee-config';
import { AllowanceService } from './tag';

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

// Helpers para convertir entre string y bigint
const toBigInt = (val: string | bigint | null | undefined): bigint => {
  if (val === null || val === undefined) return BigInt(0);
  if (typeof val === 'bigint') return val;
  return BigInt(val);
};
const toString = (val: bigint): string => val.toString();

// Wrapper que convierte los campos varchar a bigint
function toAllowanceDomain(row: Allowance): AllowanceDomain {
  return {
    id: row.id,
    userId: row.userId,
    tokenAddress: row.tokenAddress,
    chainId: row.chainId,
    approvedAmount: toBigInt(row.approvedAmount),
    usedAmount: toBigInt(row.usedAmount),
    feeCollected: toBigInt(row.feeCollected),
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const AllowanceServiceLive = Layer.effect(
  AllowanceService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    const getOrCreateAllowance = (
      userId: number,
      tokenAddress: string,
      chainId: number
    ): Effect.Effect<AllowanceDomain, DatabaseError, never> =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(allowances)
              .where(
                and(
                  eq(allowances.userId, userId),
                  eq(allowances.tokenAddress, tokenAddress),
                  eq(allowances.chainId, chainId)
                )
              )
              .limit(1);
            return result ? toAllowanceDomain(result) : null;
          },
          catch: (error) => new DatabaseError(error),
        });

        if (existing) {
          return existing;
        }

        // Create new allowance record
        const newAllowance: NewAllowance = {
          userId,
          tokenAddress,
          chainId,
          approvedAmount: '0',
          usedAmount: '0',
          feeCollected: '0',
        };

        const [result] = yield* Effect.tryPromise({
          try: async () => {
            return await db.insert(allowances).values(newAllowance).returning();
          },
          catch: (error) => new DatabaseError(error),
        });

        return toAllowanceDomain(result!);
      });

    return AllowanceService.of({
      checkAllowance: (userId, tokenAddress, chainId, tradeAmount) =>
        Effect.gen(function* () {
          const allowance = yield* getOrCreateAllowance(userId, tokenAddress, chainId);

          const available = allowance.approvedAmount - allowance.usedAmount - allowance.feeCollected;
          const fee = calculateFee(tradeAmount);
          const required = tradeAmount + fee;

          const result: AllowanceCheck = {
            available,
            required,
            fee,
            sufficient: available >= required,
          };

          return result;
        }),

      recordUsage: (userId, tokenAddress, chainId, tradeAmount, feeAmount) =>
        Effect.gen(function* () {
          const allowance = yield* getOrCreateAllowance(userId, tokenAddress, chainId);

          const newUsedAmount = toString(allowance.usedAmount + tradeAmount);
          const newFeeCollected = toString(allowance.feeCollected + feeAmount);

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(allowances)
                .set({
                  usedAmount: newUsedAmount,
                  feeCollected: newFeeCollected,
                  updatedAt: new Date(),
                })
                .where(eq(allowances.id, allowance.id));
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      setApprovedAmount: (userId, tokenAddress, chainId, approvedAmount) =>
        Effect.gen(function* () {
          const allowance = yield* getOrCreateAllowance(userId, tokenAddress, chainId);

          // Reset used amount if allowance decreased (possible revoke)
          const resetUsed = approvedAmount < allowance.approvedAmount;

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(allowances)
                .set({
                  approvedAmount: toString(approvedAmount),
                  ...(resetUsed ? { usedAmount: '0' } : {}),
                  lastSyncAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(allowances.id, allowance.id));
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      getAllowance: (userId, tokenAddress, chainId) =>
        Effect.tryPromise({
          try: async () => {
            const [result] = await db
              .select()
              .from(allowances)
              .where(
                and(
                  eq(allowances.userId, userId),
                  eq(allowances.tokenAddress, tokenAddress),
                  eq(allowances.chainId, chainId)
                )
              )
              .limit(1);
            return result ? toAllowanceDomain(result) : null;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getTotalFeesCollected: (userId) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db.select().from(allowances).where(eq(allowances.userId, userId));
            return results.reduce((sum, a) => sum + toBigInt(a.feeCollected), BigInt(0));
          },
          catch: (error) => new DatabaseError(error),
        }),

      getRemainingAllowance: (userId, tokenAddress, chainId) =>
        Effect.gen(function* () {
          const allowance = yield* getOrCreateAllowance(userId, tokenAddress, chainId);
          return allowance.approvedAmount - allowance.usedAmount - allowance.feeCollected;
        }),
    });
  })
);

// Test layer
export const AllowanceServiceTest = Layer.succeed(
  AllowanceService,
  AllowanceService.of({
    checkAllowance: () =>
      Effect.succeed({
        available: BigInt(1000000000), // 1000 USDC
        required: BigInt(0),
        fee: BigInt(0),
        sufficient: true,
      }),
    recordUsage: () => Effect.succeed(undefined),
    setApprovedAmount: () => Effect.succeed(undefined),
    getAllowance: () => Effect.succeed(null),
    getTotalFeesCollected: () => Effect.succeed(BigInt(0)),
    getRemainingAllowance: () => Effect.succeed(BigInt(1000000000)),
  })
);
