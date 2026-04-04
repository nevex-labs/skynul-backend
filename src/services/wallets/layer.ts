import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { users, wallets } from '../../infrastructure/db/schema';
import type { Wallet } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { type ChainType, WalletService } from './tag';

export const WalletServiceLive = Layer.effect(
  WalletService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return WalletService.of({
      findOrCreateUser: (address: string, chain: ChainType) =>
        Effect.gen(function* () {
          // Check if wallet exists
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [wallet] = await db
                .select()
                .from(wallets)
                .where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chain, chain)))
                .limit(1);
              return wallet || null;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (existing) {
            // Update last signed at
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(wallets)
                  .set({ lastSignedAt: new Date() })
                  .where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chain, chain)));
              },
              catch: (error) => new DatabaseError(error),
            });
            return { userId: existing.userId, wallet: existing };
          }

          // Create new user and wallet
          const [newUser] = yield* Effect.tryPromise({
            try: async () => {
              return await db.insert(users).values({}).returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          const [newWallet] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(wallets)
                .values({
                  userId: newUser.id,
                  address: address.toLowerCase(),
                  chain,
                  isPrimary: 'true',
                  lastSignedAt: new Date(),
                })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return { userId: newUser.id, wallet: newWallet };
        }),

      getWallet: (address: string, chain: ChainType) =>
        Effect.tryPromise({
          try: async () => {
            const [wallet] = await db
              .select()
              .from(wallets)
              .where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chain, chain)))
              .limit(1);
            return wallet || null;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getUserWallets: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(wallets).where(eq(wallets.userId, userId));
          },
          catch: (error) => new DatabaseError(error),
        }),

      updateLastSignedAt: (address: string, chain: ChainType) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(wallets)
              .set({ lastSignedAt: new Date() })
              .where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chain, chain)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      removeWallet: (address: string, chain: ChainType) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(wallets).where(and(eq(wallets.address, address.toLowerCase()), eq(wallets.chain, chain)));
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Test layer
export const WalletServiceTest = Layer.succeed(
  WalletService,
  WalletService.of({
    findOrCreateUser: (address, chain) =>
      Effect.succeed({
        userId: 1,
        wallet: {
          id: 1,
          userId: 1,
          address: address.toLowerCase(),
          chain,
          isPrimary: 'true',
          lastSignedAt: new Date(),
          createdAt: new Date(),
        } as Wallet,
      }),
    getWallet: () => Effect.succeed(null),
    getUserWallets: () => Effect.succeed([]),
    updateLastSignedAt: () => Effect.succeed(undefined),
    removeWallet: () => Effect.succeed(undefined),
  })
);
