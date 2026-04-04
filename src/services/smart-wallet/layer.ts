/**
 * SmartWalletService Live implementation.
 *
 * Uses the infrastructure adapters to manage Smart Accounts.
 * For MVP, stores Smart Account addresses in a simple map.
 * In production, this would use a DB table for smart_accounts.
 */

import { Effect, Layer } from 'effect';
import type { SessionKey } from '../../core/chain/domain';
import { createSmartWallet } from '../../core/chain/infrastructure';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { SmartWalletService } from './tag';

// In-memory store for MVP — replace with DB table in production
const smartAccounts = new Map<string, string>(); // `${userId}-${chainId}` -> address
const sessionKeys = new Map<string, SessionKey>();

export const SmartWalletServiceLive = Layer.effect(
  SmartWalletService,
  Effect.gen(function* () {
    yield* DatabaseService;

    return SmartWalletService.of({
      getOrCreateSmartAccount: (userId, chainId) =>
        Effect.sync(() => {
          const key = `${userId}-${chainId}`;
          const existing = smartAccounts.get(key);
          if (existing) return existing;

          // In production: deploy Smart Account via EntryPoint
          // For now, generate a deterministic address
          const mockAddress = `0x${'0'.repeat(40 - 8)}${userId.toString(16).padStart(8, '0')}${chainId.toString(16).padStart(8, '0')}`;
          smartAccounts.set(key, mockAddress);
          return mockAddress;
        }),

      getSmartAccount: (userId, chainId) =>
        Effect.sync(() => {
          const key = `${userId}-${chainId}`;
          return smartAccounts.get(key) ?? null;
        }),

      isAccountDeployed: (_address, _chainId) =>
        Effect.sync(() => {
          // In production: check bytecode on-chain
          return true;
        }),

      getTokenBalance: (_smartAccountAddress, _tokenAddress, _chainId) =>
        Effect.sync(() => {
          // In production: use viem to read ERC-20 balanceOf
          return BigInt(0);
        }),

      createSessionKey: (userId, chainId, params) =>
        Effect.sync(() => {
          const key = `${userId}-${chainId}`;
          const sessionKey: SessionKey = {
            address: `0x${'0'.repeat(40 - 16)}${Date.now().toString(16).padStart(16, '0')}`,
            maxPerTrade: params.maxPerTrade,
            dailyLimit: params.dailyLimit,
            expiresAt: params.expiresAt,
            allowedTokens: params.allowedTokens,
          };
          sessionKeys.set(key, sessionKey);
          return sessionKey;
        }),

      revokeSessionKey: (userId, chainId) =>
        Effect.sync(() => {
          const key = `${userId}-${chainId}`;
          sessionKeys.delete(key);
        }),

      getSessionKey: (userId, chainId) =>
        Effect.sync(() => {
          const key = `${userId}-${chainId}`;
          return sessionKeys.get(key) ?? null;
        }),
    });
  })
);

// Test layer
export const SmartWalletServiceTest = Layer.succeed(
  SmartWalletService,
  SmartWalletService.of({
    getOrCreateSmartAccount: () => Effect.succeed('0xSmartAccount123'),
    getSmartAccount: () => Effect.succeed('0xSmartAccount123'),
    isAccountDeployed: () => Effect.succeed(true),
    getTokenBalance: () => Effect.succeed(BigInt(1000000000)), // 1000 USDC
    createSessionKey: () =>
      Effect.succeed({
        address: '0xSessionKey123',
        maxPerTrade: BigInt(50000000),
        dailyLimit: BigInt(200000000),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        allowedTokens: ['0xUSDC', '0xWETH'],
      }),
    revokeSessionKey: () => Effect.succeed(undefined),
    getSessionKey: () =>
      Effect.succeed({
        address: '0xSessionKey123',
        maxPerTrade: BigInt(50000000),
        dailyLimit: BigInt(200000000),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        allowedTokens: ['0xUSDC', '0xWETH'],
      }),
  })
);
